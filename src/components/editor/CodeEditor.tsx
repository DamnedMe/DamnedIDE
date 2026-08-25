import { useState, useEffect, useRef, useCallback } from 'react'
import { PanelContainer } from '../layout/PanelContainer'
import { ResizableSplitter } from '../layout/ResizableSplitter'
import { FileTree } from './FileTree'
import { DiffViewer } from './DiffViewer'
import { GlobalSearch } from './GlobalSearch'
import { GitBar } from './GitBar'
import { GitModal } from './GitModal'
import { ChangesPanel } from './ChangesPanel'
import { findBestLine, searchWorkspaceFiles, findReferenceLines, searchWorkspaceReferences, searchImplementations, type WorkspaceHit } from './symbol-search'
import { ReferencesModal } from './ReferencesModal'
import { applyCSharpDiagnostics, clearCSharpDiagnostics, scheduleCSharpDiagnostics, type DiagnosticCounts } from '../../utils/csharp-diagnostics'
import { registerCSharpHover, trackHoverModel } from '../../utils/csharp-hover'
import { FileTypeIcon } from '../../utils/file-icon'
import { TerminalDock } from '../terminal/TerminalDock'
import { MarkdownView } from './MarkdownView'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import { defineThemes, THEME_DARK, THEME_LIGHT, patchCSharpGrammar } from './monaco-theme'
import { useEditorStore, useWorktreeStore, useUIStore, useSettingsStore } from '../../store'
import {
  FileCode, FolderOpen, X, Circle,
  PanelLeftClose, PanelLeftOpen, FolderTree, Search,
  ChevronRight, Asterisk, Regex, CaseSensitive, SeparatorHorizontal,
  Play, Hammer, Square, RotateCw, GitCompare,
  ArrowLeft, ArrowRight, XCircle, AlertTriangle, Eye, Copy, Loader2
} from 'lucide-react'

type LeftPanel = 'explorer' | 'search' | 'changes'
type MonacoEditor = Parameters<OnMount>[0]

// C# keywords: the Roslyn bridge cannot resolve these, and the fallback would hang
const CSharpKeywordSet = new Set([
  'using', 'namespace', 'class', 'interface', 'struct', 'enum', 'record', 'public', 'private',
  'protected', 'internal', 'static', 'void', 'int', 'string', 'bool', 'var', 'return', 'new',
  'if', 'else', 'for', 'foreach', 'while', 'switch', 'case', 'break', 'continue', 'async',
  'await', 'readonly', 'const', 'get', 'set', 'this', 'base', 'null', 'true', 'false', 'override',
  'virtual', 'abstract', 'sealed', 'partial', 'ref', 'out', 'in', 'yield', 'try', 'catch',
  'throw', 'finally', 'typeof', 'nameof', 'default', 'is', 'as', 'when', 'where', 'params',
  'lock', 'unsafe', 'fixed', 'checked', 'unchecked', 'operator', 'implicit', 'explicit',
  'event', 'delegate', 'namespace'
])

interface EditorCtxMenu {
  show: boolean
  x: number
  y: number
  lineNumber: number
  symbol: string | null
  isModified: boolean
}

interface OpenFile {
  path: string
  content: string
  dirty: boolean
}

interface NavEntry {
  path: string
  line: number
}

interface SolutionProject {
  name: string
  csprojPath: string
  projectDir: string
  relative: string
}

interface RunConfig {
  startupProject?: string
  launchProfile?: string
}

interface LaunchProfileInfo {
  profiles: string[]
  launchUrls: Record<string, string>
}

type OutputLevel = 'info' | 'trace' | 'warn' | 'error'

interface OutputEntry {
  level: OutputLevel
  text: string
}

const OUTPUT_LEVEL_COLORS: Record<OutputLevel, string> = {
  info: 'var(--accent-color)',
  trace: 'var(--text-primary)',
  warn: 'var(--warning-color)',
  error: 'var(--error-color)'
}

// dotnet build/run output is piped (no TTY), so it is plain text; classify each
// line by its content to let the user filter warnings/errors from the noise.
const classifyOutputLine = (line: string): OutputLevel => {
  const l = line.toLowerCase()
  if (/\berror\b|errore|exception|failed|fallito|impossibile|cannot|unable|non è riuscit/.test(l)) return 'error'
  if (/warning|avviso/.test(l)) return 'warn'
  return 'trace'
}

const readLaunchProfiles = async (projectDir: string): Promise<LaunchProfileInfo> => {
  const empty: LaunchProfileInfo = { profiles: [], launchUrls: {} }
  try {
    // existence check first: readFile on a missing file logs ENOENT in the main process
    const entries = await window.electronAPI.fs.readDir(`${projectDir}\\Properties`).catch(() => [])
    if (!entries.some(e => e.isFile && e.name.toLowerCase() === 'launchsettings.json')) return empty
    const raw = await window.electronAPI.fs.readFile(`${projectDir}\\Properties\\launchSettings.json`)
    const data = JSON.parse(raw) as { profiles?: Record<string, { launchUrl?: string }> }
    if (!data.profiles || typeof data.profiles !== 'object') return empty
    const profiles = Object.keys(data.profiles)
    const launchUrls: Record<string, string> = {}
    for (const name of profiles) {
      const url = data.profiles[name]?.launchUrl
      if (url) launchUrls[name] = url
    }
    return { profiles, launchUrls }
  } catch {
    return empty
  }
}

export function CodeEditor() {
  const rootPath = useEditorStore(s => s.editorRootPath)
  const setRootPath = useEditorStore(s => s.setEditorRootPath)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [leftPanel, setLeftPanel] = useState<LeftPanel>('explorer')
  const [explorerVisible, setExplorerVisible] = useState(true)
  const [diffView, setDiffView] = useState<{ original: string; modified: string; path: string } | null>(null)
  const editorRef = useRef<MonacoEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const pendingLineRef = useRef<number | null>(null)
  const activeFileRef = useRef<string | null>(null)
  const originalContentsRef = useRef<Map<string, string>>(new Map())
  const decorationIdsRef = useRef<Map<string, string[]>>(new Map())
  const modifiedLinesRef = useRef<Map<string, Set<number>>>(new Map())
  const [ctxMenu, setCtxMenu] = useState<EditorCtxMenu | null>(null)
  const [referencesModal, setReferencesModal] = useState<{ symbol: string; hits: WorkspaceHit[] } | null>(null)
  const [implPicker, setImplPicker] = useState<{ symbol: string; hits: WorkspaceHit[] } | null>(null)
  const [fileFilter, setFileFilter] = useState('')
  const [filterMode, setFilterMode] = useState<'startsWith' | 'like' | 'regex'>('like')
  const [filterCaseSensitive, setFilterCaseSensitive] = useState(false)
  const [filterSpaceSensitive, setFilterSpaceSensitive] = useState(false)
  const [fontSize, setFontSize] = useState(12.5)
  const fontSizeRef = useRef(12.5)
  const setEditorNav = useEditorStore(s => s.setEditorNav)
  const settings = useSettingsStore(s => s.settings)
  const [mdPreview, setMdPreview] = useState(false)
  const isMarkdownActive = !!activeFile?.toLowerCase().endsWith('.md')
  const [quickOutput, setQuickOutput] = useState<OutputEntry[] | null>(null)
  const [outputFilter, setOutputFilter] = useState<Record<OutputLevel, boolean>>({ info: true, trace: true, warn: true, error: true })
  const [isRunning, setIsRunning] = useState(false)
  const [runningProcessId, setRunningProcessId] = useState<string | null>(null)
  const [buildProgress, setBuildProgress] = useState<{ completed: number; total: number } | null>(null)
  const outputBufferRef = useRef('')
  const buildOutputBufferRef = useRef('')
  const buildProjectNamesRef = useRef<string[]>([])
  const buildCompletedProjectsRef = useRef(new Set<string>())
  const buildTotalRef = useRef(0)
  const outputAreaRef = useRef<HTMLPreElement | null>(null)
  const runningKindRef = useRef<'build' | 'run' | null>(null)
  const launchUrlRef = useRef<string | null>(null)
  const browserOpenedRef = useRef(false)
  const [gitModal, setGitModal] = useState<{ title: string; text?: string; blame?: { hash: string; author: string; date: string; line: string }[]; history?: { hash: string; date: string; message: string; authorName: string }[] } | null>(null)
  const openFileRef = useRef<(f: string, l?: number, fromNavigation?: boolean) => void>(() => {})
  const rootPathRef = useRef<string | null>(null)
  const previousRootPathRef = useRef<string | null>(null)
  const navBackRef = useRef<NavEntry[]>([])
  const navForwardRef = useRef<NavEntry[]>([])
  const [, setNavVersion] = useState(0)
  const roslynReadyRef = useRef(false)
  const roslynOffRef = useRef(false)
  const roslynStartingRef = useRef(false)
  const roslynReadyPromiseRef = useRef<Promise<boolean> | null>(null)
  const [roslynStatus, setRoslynStatus] = useState<'off' | 'indexing' | 'ready'>('off')
  const [csErrorCount, setCsErrorCount] = useState<DiagnosticCounts>({ errors: 0, warnings: 0 })

  // Warm up the Roslyn bridge when a .cs file becomes active (loads the solution via
  // MSBuildWorkspace in the sidecar, so symbol navigation is semantic, not heuristic).
  useEffect(() => {
    const file = activeFile
    if (!file?.toLowerCase().endsWith('.cs')) return
    if (roslynReadyRef.current || roslynOffRef.current || roslynStartingRef.current) return
    const root = rootPathRef.current
    if (!root) return
    roslynStartingRef.current = true
    setRoslynStatus('indexing')
    const ensurePromise = window.electronAPI.roslyn.ensure(root)
    roslynReadyPromiseRef.current = ensurePromise
    ensurePromise
      .then(ok => {
        roslynStartingRef.current = false
        if (ok) {
          roslynReadyRef.current = true
          setRoslynStatus('ready')
        } else {
          roslynOffRef.current = true
          setRoslynStatus('off')
        }
      })
      .catch(() => {
        roslynStartingRef.current = false
        roslynOffRef.current = true
        setRoslynStatus('off')
      })
  }, [activeFile])

  // Live compiler diagnostics (squiggles) for .cs files, like Visual Studio.
  useEffect(() => {
    const ed = editorRef.current
    const mo = monacoRef.current
    if (!ed || !mo) return
    const file = activeFile
    if (!file?.toLowerCase().endsWith('.cs') || !roslynReadyRef.current) {
      clearCSharpDiagnostics(ed, mo)
      setCsErrorCount({ errors: 0, warnings: 0 })
      return
    }
    applyCSharpDiagnostics(ed, mo, file).then(setCsErrorCount)
  }, [activeFile, roslynStatus])

  useEffect(() => {
    const nav = useEditorStore.getState().editorNav
    if (nav) {
      setEditorNav(null)
      setRootPath(nav.rootPath)
      setExplorerVisible(true)
      setLeftPanel('explorer')
      setTimeout(() => openFile(nav.filePath, nav.line), 0)
      return
    }
    const wt = useWorktreeStore.getState().selectedWorktree
    if (wt && !useEditorStore.getState().editorRootPath) {
      setRootPath(wt)
      setExplorerVisible(true)
      setLeftPanel('explorer')
    }
  }, [setRootPath, setEditorNav])

  activeFileRef.current = activeFile
  rootPathRef.current = rootPath

  // Switching worktrees changes the editor workspace. Clear files and
  // navigation from the previous root, while keeping them across panel changes
  // where the root itself does not change.
  useEffect(() => {
    const previous = previousRootPathRef.current
    if (previous && previous !== rootPath) {
      setOpenFiles([])
      setActiveFile(null)
      setDiffView(null)
      setMdPreview(false)
      pendingLineRef.current = null
      originalContentsRef.current.clear()
      decorationIdsRef.current.clear()
      modifiedLinesRef.current.clear()
      navBackRef.current = []
      navForwardRef.current = []
      setNavVersion(v => v + 1)
      roslynReadyRef.current = false
      roslynOffRef.current = false
      roslynStartingRef.current = false
      roslynReadyPromiseRef.current = null
      setRoslynStatus('off')
      setCsErrorCount({ errors: 0, warnings: 0 })
    }
    previousRootPathRef.current = rootPath
  }, [rootPath])

  const updateModifiedDecorations = useCallback((editor: MonacoEditor, monaco: typeof import('monaco-editor'), filePath: string) => {
    const model = editor.getModel()
    if (!model) return
    const current = model.getValue()
    if (!originalContentsRef.current.has(filePath)) {
      originalContentsRef.current.set(filePath, current)
      return
    }
    const original = originalContentsRef.current.get(filePath)!
    const oldIds = decorationIdsRef.current.get(filePath) || []
    if (original === current) {
      editor.deltaDecorations(oldIds, [])
      decorationIdsRef.current.set(filePath, [])
      modifiedLinesRef.current.delete(filePath)
      return
    }
    const origLines = original.split('\n')
    const currLines = current.split('\n')
    const modifiedLines = new Set<number>()
    const maxLen = Math.max(origLines.length, currLines.length)
    for (let i = 0; i < maxLen; i++) {
      if (origLines[i] !== currLines[i]) modifiedLines.add(i + 1)
    }
    const decs: monacoEditor.IModelDeltaDecoration[] = []
    let start = 0
    for (let line = 1; line <= maxLen + 1; line++) {
      if (line <= maxLen && modifiedLines.has(line)) {
        if (start === 0) start = line
      } else if (start > 0) {
        decs.push({
          range: new monaco.Range(start, 1, line - 1, 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: 'modified-line-gutter',
            overviewRuler: { color: 'var(--accent-color)', position: monaco.editor.OverviewRulerLane.Left }
          }
        })
        start = 0
      }
    }
    const ids = editor.deltaDecorations(oldIds, decs)
    decorationIdsRef.current.set(filePath, ids)
    modifiedLinesRef.current.set(filePath, modifiedLines)
  }, [])

  const filter: { query: string; mode: 'startsWith' | 'like' | 'regex'; caseSensitive: boolean; spaceSensitive: boolean } | null =
    fileFilter ? { query: fileFilter, mode: filterMode, caseSensitive: filterCaseSensitive, spaceSensitive: filterSpaceSensitive } : null

  const closeCtxMenu = () => setCtxMenu(null)

  useEffect(() => {
    if (!ctxMenu?.show) return
    const handler = (e: MouseEvent) => {
      // clicks inside the menu are handled by its items (don't close before the click fires)
      const inside = (e.target as HTMLElement)?.closest?.('[data-role="editor-ctx-menu"]')
      if (inside) return
      setCtxMenu(null)
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [ctxMenu?.show])

  const revertLine = (lineNumber: number) => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const file = activeFileRef.current
    if (!editor || !monaco || !file) return
    const original = originalContentsRef.current.get(file)
    if (!original) return
    const origLines = original.split('\n')
    const model = editor.getModel()
    if (!model) return
    const idx = lineNumber - 1
    if (idx < 0 || idx >= origLines.length) return
    const range = new monaco.Range(lineNumber, 1, lineNumber, model.getLineMaxColumn(lineNumber))
    model.pushEditOperations([], [{ range, text: origLines[idx] }], () => null)
    setCtxMenu(null)
  }

  const revertBlock = (lineNumber: number) => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const file = activeFileRef.current
    if (!editor || !monaco || !file) return
    const original = originalContentsRef.current.get(file)
    if (!original) return
    const mlines = modifiedLinesRef.current.get(file)
    if (!mlines) return
    const model = editor.getModel()
    if (!model) return
    if (!mlines.has(lineNumber)) return
    let start = lineNumber
    while (mlines.has(start - 1)) start--
    let end = lineNumber
    while (mlines.has(end + 1)) end++
    const origLines = original.split('\n')
    const operations: monacoEditor.IIdentifiedSingleEditOperation[] = []
    for (let l = start; l <= end; l++) {
      const idx = l - 1
      if (idx >= 0 && idx < origLines.length)
        operations.push({
          range: new monaco.Range(l, 1, l, model.getLineMaxColumn(l)),
          text: origLines[idx]
        })
    }
    model.pushEditOperations([], operations, () => null)
    setCtxMenu(null)
  }

  // ─── Keyboard shortcuts ────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setExplorerVisible(true)
        setLeftPanel('search')
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveActiveFile()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  // ─── File operations ───────────────────────────────
  const openFile = useCallback(async (filePath: string, line?: number, fromNavigation = false) => {
    const current = activeFileRef.current
    if (current && current !== filePath && !fromNavigation) {
      const editor = editorRef.current
      navBackRef.current = [...navBackRef.current, { path: current, line: editor?.getPosition()?.lineNumber ?? 1 }].slice(-100)
      navForwardRef.current = []
      setNavVersion(v => v + 1)
    }
    if (line) pendingLineRef.current = line
    setActiveFile(filePath)
    setDiffView(null)
    setOpenFiles(prev => {
      if (prev.some(f => f.path === filePath)) return prev
      return [...prev, { path: filePath, content: '', dirty: false }]
    })
    const existing = openFiles.find(f => f.path === filePath)
    if (!existing) {
      try {
        const content = await window.electronAPI.fs.readFile(filePath)
        originalContentsRef.current.set(filePath, content)
        setOpenFiles(prev => prev.map(f => f.path === filePath ? { ...f, content } : f))
      } catch {
        setOpenFiles(prev => prev.map(f => f.path === filePath ? { ...f, content: `// unable to read` } : f))
      }
    }
  }, [openFiles])
  openFileRef.current = openFile

  const closeFile = (filePath: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setOpenFiles(prev => {
      const next = prev.filter(f => f.path !== filePath)
      if (activeFile === filePath) {
        setActiveFile(next.length > 0 ? next[next.length - 1].path : null)
      }
      return next
    })
  }

  const updateContent = (value: string) => {
    if (!activeFile) return
    setOpenFiles(prev => prev.map(f =>
      f.path === activeFile ? { ...f, content: value, dirty: true } : f
    ))
  }

  const saveActiveFile = async () => {
    const file = openFiles.find(f => f.path === activeFile)
    if (!file || !file.dirty) return
    try {
      await window.electronAPI.fs.writeFile(file.path, file.content)
      setOpenFiles(prev => prev.map(f => f.path === file.path ? { ...f, dirty: false } : f))
      originalContentsRef.current.set(file.path, file.content)
      const editor = editorRef.current
      const monaco = monacoRef.current
      if (editor && monaco) updateModifiedDecorations(editor, monaco, file.path)
    } catch { /* ignore */ }
  }

  const goToSymbol = async (kind: 'definition' | 'implementation', symbolOverride?: string) => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const model = editor.getModel()
    const pos = editor.getPosition()
    if (!model || !pos) return
    const word = symbolOverride ? { word: symbolOverride } : model.getWordAtPosition(pos)
    if (!word?.word) return
    const symbol = word.word
    const lines = model.getValue().split('\n')

    // Roslyn fast path for .cs files: semantic resolution instead of heuristics
    const currentFile = activeFileRef.current
    if (currentFile?.toLowerCase().endsWith('.cs')) {
      // first use of the sidecar is slow (solution load): wait for the warm-up
      // already running instead of falling back to the slow heuristic scan
      if (!roslynReadyRef.current && roslynReadyPromiseRef.current) {
        await roslynReadyPromiseRef.current
      }
      if (roslynReadyRef.current) {
        try {
          const r = kind === 'definition'
            ? await window.electronAPI.roslyn.definition(currentFile, pos.lineNumber, pos.column)
            : await window.electronAPI.roslyn.implementation(currentFile, pos.lineNumber, pos.column)
          if (r && r.targets.length > 0) {
            const norm = (p: string) => p.replace(/\\/g, '/')
            const filtered = r.targets.filter(t => !(norm(t.file).toLowerCase() === norm(currentFile).toLowerCase() && t.line === pos.lineNumber))
            if (filtered.length === 1) {
              openFileRef.current(filtered[0].file, filtered[0].line)
            } else if (filtered.length > 1) {
              setImplPicker({ symbol: r.symbol || symbol, hits: filtered })
            }
            return
          }
        } catch { /* fall back to heuristics */ }
      }
    }

    // 1) current file
    const line = findBestLine(lines, symbol, kind, pos.lineNumber)
    if (line) {
      editor.revealLineInCenter(line)
      editor.setPosition({ lineNumber: line, column: 1 })
      editor.focus()
      return
    }

    // 2) open models (already loaded tabs)
    for (const m of monaco.editor.getModels()) {
      if (m === model) continue
      const ml = m.getValue().split('\n')
      const found = findBestLine(ml, symbol, kind, 0)
      if (found) {
        openFileRef.current(m.uri.fsPath || m.uri.path, found)
        return
      }
    }

    // 3) workspace scan
    if (kind === 'implementation') {
      // collect EVERY implementation: when several classes implement the same
      // interface member, let the user pick from a list
      const hits = await searchImplementations(rootPathRef.current || '', symbol)
      const filtered = hits.filter(h => !(h.file === activeFileRef.current && h.line === pos.lineNumber))
      if (filtered.length === 1) {
        openFileRef.current(filtered[0].file, filtered[0].line)
      } else if (filtered.length > 1) {
        setImplPicker({ symbol, hits: filtered })
      } else if (hits.length === 1) {
        editor.focus() // only the current declaration: stay put
      }
      return
    }
    const hit = await searchWorkspaceFiles(rootPathRef.current || '', symbol, kind)
    if (hit) {
      if (hit.file === activeFileRef.current) {
        // already on the declaration: keep the position (VS behavior)
        if (hit.line !== pos.lineNumber) {
          editor.revealLineInCenter(hit.line)
          editor.setPosition({ lineNumber: hit.line, column: 1 })
        }
        editor.focus()
      } else {
        openFileRef.current(hit.file, hit.line)
      }
    }
  }

  const findReferences = async (symbolOverride?: string) => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const model = editor.getModel()
    const pos = editor.getPosition()
    if (!model || !pos) return
    const word = symbolOverride ? { word: symbolOverride } : model.getWordAtPosition(pos)
    if (!word?.word) return
    const symbol = word.word
    const lines = model.getValue().split('\n')

    // Roslyn fast path for .cs files: semantic references (skip C# keywords — the
    // bridge cannot resolve them and the fallback would hang)
    const currentFile = activeFileRef.current
    if (currentFile?.toLowerCase().endsWith('.cs') && roslynReadyRef.current && !CSharpKeywordSet.has(symbol.toLowerCase())) {
      try {
        const r = await window.electronAPI.roslyn.references(currentFile, pos.lineNumber, pos.column)
        if (r && r.targets.length > 0) {
          setReferencesModal({ symbol: r.symbol || symbol, hits: r.targets })
          return
        }
      } catch { /* fall back to heuristics */ }
    }

    const hits: WorkspaceHit[] = []
    // 1) current file (exclude the line where the symbol sits)
    for (const ln of findReferenceLines(lines, symbol, pos.lineNumber)) {
      hits.push({ file: model.uri.fsPath || model.uri.path, line: ln })
    }
    // 2) open models (already loaded tabs)
    for (const m of monaco.editor.getModels()) {
      if (m === model) continue
      for (const ln of findReferenceLines(m.getValue().split('\n'), symbol, 0)) {
        hits.push({ file: m.uri.fsPath || m.uri.path, line: ln })
      }
    }
    const ws = await searchWorkspaceReferences(rootPathRef.current || '', symbol)
    const seen = new Set<string>()
    const unique: WorkspaceHit[] = []
    for (const h of [...hits, ...ws]) {
      const key = `${h.file}:${h.line}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(h)
    }
    setReferencesModal({ symbol, hits: unique })
  }

  const zoomIn = () => { const f = Math.min(fontSizeRef.current + 1, 28); fontSizeRef.current = f; setFontSize(f); editorRef.current?.updateOptions({ fontSize: f }) }
  const zoomOut = () => { const f = Math.max(fontSizeRef.current - 1, 6); fontSizeRef.current = f; setFontSize(f); editorRef.current?.updateOptions({ fontSize: f }) }
  const zoomReset = () => { fontSizeRef.current = 12.5; setFontSize(12.5); editorRef.current?.updateOptions({ fontSize: 12.5 }) }

  const goBack = () => {    const back = navBackRef.current
    if (back.length === 0) return
    const entry = back[back.length - 1]
    navBackRef.current = back.slice(0, -1)
    const editor = editorRef.current
    const current = activeFileRef.current
    if (current) navForwardRef.current = [...navForwardRef.current, { path: current, line: editor?.getPosition()?.lineNumber ?? 1 }].slice(-100)
    setNavVersion(v => v + 1)
    openFileRef.current(entry.path, entry.line, true)
  }

  const goForward = () => {
    const fwd = navForwardRef.current
    if (fwd.length === 0) return
    const entry = fwd[fwd.length - 1]
    navForwardRef.current = fwd.slice(0, -1)
    const editor = editorRef.current
    const current = activeFileRef.current
    if (current) navBackRef.current = [...navBackRef.current, { path: current, line: editor?.getPosition()?.lineNumber ?? 1 }].slice(-100)
    setNavVersion(v => v + 1)
    openFileRef.current(entry.path, entry.line, true)
  }

  // reveal a line with retries: at open the model may still be loading and the
  // viewport can be collapsed to ~1 line, so a single revealLineInCenter is a
  // no-op and the file lands at the top (fix: first Go to Implementation)
  const revealLineInEditor = (editor: monacoEditor.IStandaloneCodeEditor, line: number) => {
    let tries = 0
    const attempt = () => {
      try {
        const vr = editor.getVisibleRanges()?.[0]
        const viewReady = !!vr && (vr.endLineNumber - vr.startLineNumber) >= 4
        const modelReady = (editor.getModel()?.getLineCount() ?? 0) >= line
        if ((viewReady && modelReady) || tries > 40) {
          editor.setPosition({ lineNumber: line, column: 1 })
          editor.revealLineInCenter(line)
          editor.focus()
        } else {
          tries++
          setTimeout(attempt, 60)
        }
      } catch { /* ignore */ }
    }
    attempt()
  }

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    applyEditorTheme(monaco)
    registerCSharpHover(monaco)
    trackHoverModel(editor.getModel(), activeFileRef.current)
    editor.onDidChangeModel(() => {
      trackHoverModel(editor.getModel(), activeFileRef.current)
    })
    try {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveActiveFile())
      editor.addCommand(monaco.KeyCode.F12, () => goToSymbol('definition'))
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12, () => goToSymbol('implementation'))
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.F12, () => findReferences())
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => zoomIn())
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0, () => zoomReset())
      // navigation back/forward, binding configurabile (VS Studio default, VS Code alternativo)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => {
        if (useSettingsStore.getState().settings.navKeybindings === 'vs-studio') goBack()
        else zoomOut()
      })
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Minus, () => {
        if (useSettingsStore.getState().settings.navKeybindings === 'vs-studio') goForward()
      })
      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow, () => {
        if (useSettingsStore.getState().settings.navKeybindings === 'vs-code') goBack()
      })
      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.RightArrow, () => {
        if (useSettingsStore.getState().settings.navKeybindings === 'vs-code') goForward()
      })
    } catch (e) {
      console.error('[editor] comandi non registrati:', e)
    }
    const model = editor.getModel()
    if (model) {
      model.onDidChangeContent(() => {
        const file = activeFileRef.current
        if (file) updateModifiedDecorations(editor, monaco, file)
        scheduleCSharpDiagnostics(editor, monaco, file, 700, setCsErrorCount)
      })
    }
    // right-click: show ONLY our custom menu (Monaco's native one is suppressed
    // by preventDefault on the `contextmenu` event in capture phase)
    editor.getDomNode()?.addEventListener('contextmenu', (e: MouseEvent) => {
      const target = editor.getTargetAtClientPoint(e.clientX, e.clientY)
      const position = target?.position
      const file = activeFileRef.current
      const model = editor.getModel()
      const word = position ? model?.getWordAtPosition(position) : undefined
      const mlines = file ? modifiedLinesRef.current.get(file) : undefined
      const isModified = position ? !!mlines?.has(position.lineNumber) : false
      if (!word?.word && !isModified) return // whitespace → let Monaco's native menu handle it
      e.preventDefault()
      e.stopPropagation()
      setCtxMenu({
        show: true,
        x: e.clientX,
        y: e.clientY,
        lineNumber: position!.lineNumber,
        symbol: word?.word || null,
        isModified
      })
    }, true)
    if (pendingLineRef.current) {
      const line = pendingLineRef.current
      pendingLineRef.current = null
      revealLineInEditor(editor, line)
    }
  }

  useEffect(() => {
    if (!pendingLineRef.current) return
    const editor = editorRef.current
    // editor not mounted yet (first navigation) → handleEditorMount reveals it
    if (!editor) return
    const line = pendingLineRef.current
    pendingLineRef.current = null
    revealLineInEditor(editor, line)
  }, [activeFile])

  const theme = useUIStore(s => s.theme)
  const themeColors = useSettingsStore(s => s.settings.themeColors)

  const applyEditorTheme = (monaco: typeof import('monaco-editor')) => {
    defineThemes(monaco, themeColors)
    patchCSharpGrammar(monaco)
    monaco.editor.setTheme(theme === 'dark' ? THEME_DARK : THEME_LIGHT)
  }

  useEffect(() => {
    const monaco = monacoRef.current
    if (monaco) applyEditorTheme(monaco)
  }, [theme, themeColors])

  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco || !activeFile) return

    const model = editor.getModel()
    if (!model) return

    if (!originalContentsRef.current.has(activeFile))
      originalContentsRef.current.set(activeFile, model.getValue())

    updateModifiedDecorations(editor, monaco, activeFile)

    const disposable = model.onDidChangeContent(() => {
      updateModifiedDecorations(editor, monaco, activeFile)
    })
    return () => disposable.dispose()
  }, [activeFile, updateModifiedDecorations])

  const detectLang = (path?: string | null): string => {
    if (!path) return 'plaintext'
    const m: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      cs: 'csharp', csproj: 'xml', json: 'json', xml: 'xml', html: 'html',
      css: 'css', scss: 'scss', sql: 'sql', md: 'markdown', yaml: 'yaml',
      yml: 'yaml', py: 'python', rs: 'rust', go: 'go', java: 'java',
      ps1: 'powershell', sh: 'shell', dockerfile: 'dockerfile'
    }
    return m[path.split('.').pop()?.toLowerCase() || ''] || 'plaintext'
  }

  const activeContent = openFiles.find(f => f.path === activeFile)?.content ?? ''

  const [projectKind, setProjectKind] = useState<'dotnet' | 'node' | null>(null)
  const [dotnetProject, setDotnetProject] = useState<string | null>(null)
  const [solutionProjects, setSolutionProjects] = useState<SolutionProject[]>([])
  const [solutionPath, setSolutionPath] = useState<string | null>(null)
  const [startupProject, setStartupProject] = useState<SolutionProject | null>(null)
  const [launchProfiles, setLaunchProfiles] = useState<string[]>([])
  const [launchProfile, setLaunchProfile] = useState<string | null>(null)
  const [runConfigDir, setRunConfigDir] = useState<string | null>(null)

  useEffect(() => {
    if (!rootPath) {
      setProjectKind(null); setDotnetProject(null)
      setSolutionProjects([]); setSolutionPath(null); setStartupProject(null)
      setLaunchProfiles([]); setLaunchProfile(null); setRunConfigDir(null)
      return
    }
    window.electronAPI.fs.readDir(rootPath)
      .then(async entries => {
        const rootCsproj = entries.find(e => e.isFile && e.name.toLowerCase().endsWith('.csproj'))
        const sln = entries.find(e => e.isFile && e.name.toLowerCase().endsWith('.sln'))
        const hasPackage = entries.some(e => e.isFile && e.name === 'package.json')

        // shared run-config dir: the git common dir is the same for every worktree,
        // so the startup project/profile follow the solution, not the worktree
        let cfgDir: string | null = null
        try { cfgDir = await window.electronAPI.git.gitCommonDir(rootPath) } catch { /* not a git repo */ }
        setRunConfigDir(cfgDir)

        if (hasPackage && !rootCsproj && !sln) {
          setProjectKind('node'); setDotnetProject(null); setSolutionPath(null)
          setSolutionProjects([]); setStartupProject(null); setLaunchProfiles([]); setLaunchProfile(null)
          return
        }

        const slnPath = sln ? `${rootPath}\\${sln.name}` : null
        setSolutionPath(slnPath)
        const projects: SolutionProject[] = []
        const push = (rel: string) => {
          const norm = rel.split('/').join('\\')
          const abs = `${rootPath}\\${norm}`
          projects.push({
            name: norm.slice(norm.lastIndexOf('\\') + 1).replace(/\.csproj$/i, ''),
            csprojPath: abs,
            projectDir: abs.slice(0, abs.lastIndexOf('\\')),
            relative: norm
          })
        }
        if (rootCsproj) push(rootCsproj.name)
        if (sln) {
          try {
            const content = await window.electronAPI.fs.readFile(`${rootPath}\\${sln.name}`)
            const re = /Project\(".*?"\)\s*=\s*".*?",\s*"(.*?\.csproj)"/gi
            let m: RegExpExecArray | null
            while ((m = re.exec(content))) push(m[1])
          } catch { /* ignore */ }
        }
        const seen = new Set<string>()
        const uniq = projects.filter(p => { const k = p.csprojPath.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true) })
        if (uniq.length === 0) {
          setProjectKind(null); setDotnetProject(null); setSolutionPath(null)
          setSolutionProjects([]); setStartupProject(null); setLaunchProfiles([]); setLaunchProfile(null)
          return
        }
        setProjectKind('dotnet')
        setSolutionProjects(uniq)

        let saved: RunConfig | null = null
        if (cfgDir) {
          try { saved = JSON.parse(await window.electronAPI.fs.readFile(`${cfgDir}\\damnedide\\run.json`)) as RunConfig } catch { /* none yet */ }
        }

        // profiles per project: used both to pick the default startup and to fill the selector
        const profileMap: Record<string, LaunchProfileInfo> = {}
        for (const p of uniq) profileMap[p.relative] = await readLaunchProfiles(p.projectDir)

        const savedRel = saved?.startupProject
        const chosen = savedRel
          ? uniq.find(p => p.relative.toLowerCase() === savedRel.toLowerCase())
          : undefined
        const chosenProject = chosen
          ?? uniq.find(p => profileMap[p.relative].profiles.length > 0)
          ?? (rootCsproj ? uniq.find(p => p.relative.toLowerCase() === rootCsproj.name.toLowerCase()) : undefined)
          ?? uniq[0]

        setStartupProject(chosenProject)
        setDotnetProject(chosenProject.csprojPath)
        const info = profileMap[chosenProject.relative] ?? { profiles: [], launchUrls: {} }
        setLaunchProfiles(info.profiles)
        const savedProfile = saved?.launchProfile && info.profiles.includes(saved.launchProfile) ? saved.launchProfile : null
        const selectedProfile = info.profiles.length > 0 ? (savedProfile ?? info.profiles[0]) : null
        setLaunchProfile(selectedProfile)
        launchUrlRef.current = selectedProfile ? (info.launchUrls[selectedProfile] ?? null) : null
      })
      .catch(() => {
        setProjectKind(null); setDotnetProject(null); setSolutionPath(null)
        setSolutionProjects([]); setStartupProject(null); setLaunchProfiles([]); setLaunchProfile(null)
      })
  }, [rootPath])

  const saveRunConfig = async (cfg: RunConfig) => {
    if (!runConfigDir) return
    try {
      await window.electronAPI.fs.mkdir(`${runConfigDir}\\damnedide`).catch(() => {})
      await window.electronAPI.fs.writeFile(`${runConfigDir}\\damnedide\\run.json`, JSON.stringify(cfg, null, 2))
    } catch { /* not critical */ }
  }

  const handleStartupProjectChange = async (relative: string) => {
    const p = solutionProjects.find(x => x.relative === relative)
    if (!p) return
    setStartupProject(p)
    setDotnetProject(p.csprojPath)
    const info = await readLaunchProfiles(p.projectDir)
    setLaunchProfiles(info.profiles)
    const selected = info.profiles.length > 0 ? info.profiles[0] : null
    setLaunchProfile(selected)
    launchUrlRef.current = selected ? (info.launchUrls[selected] ?? null) : null
    saveRunConfig({ startupProject: p.relative, launchProfile: selected ?? undefined })
  }

  const handleLaunchProfileChange = (name: string) => {
    setLaunchProfile(name)
    saveRunConfig({ startupProject: startupProject?.relative, launchProfile: name })
  }

  const commandsFor = (): { build: { c: string; a: string[] }; run: { c: string; a: string[] } } | null => {
    if (!rootPath || !projectKind) return null
    if (projectKind === 'dotnet') {
      const proj = dotnetProject ? ['--project', dotnetProject] : []
      const run = { c: 'dotnet', a: ['run', ...proj] }
      if (launchProfile) run.a.push('--launch-profile', launchProfile)
      const buildTarget = solutionPath ?? dotnetProject
      const build = { c: 'dotnet', a: ['build', ...(buildTarget ? [buildTarget] : [])] }
      return { build, run }
    }
    return { build: { c: 'npm', a: ['run', 'build'] }, run: { c: 'npm', a: ['run', 'dev'] } }
  }

  const pushOutput = (entries: OutputEntry[]) => {
    setQuickOutput(prev => {
      const cur = prev ?? []
      return cur.length > 2000 ? cur.slice(-2000).concat(entries) : cur.concat(entries)
    })
  }

  const pushOutputLine = (level: OutputLevel, text: string) => pushOutput([{ level, text }])

  const appendOutput = (data: string) => {
    const buf = outputBufferRef.current + data
    const parts = buf.split('\n')
    outputBufferRef.current = parts.pop() ?? ''
    const entries = parts
      .map(p => p.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, ''))
      .filter(p => p.length > 0)
      .map(p => ({ level: classifyOutputLine(p), text: p }))
    if (entries.length > 0) pushOutput(entries)
  }

  const clearOutput = () => {
    outputBufferRef.current = ''
    setQuickOutput(null)
  }

  const copyOutput = () => {
    const text = (quickOutput ?? []).map(e => e.text).join('\n')
    if (text) window.electronAPI.clipboard.write(text)
  }

  const markCompiledProject = (key: string) => {
    if (buildCompletedProjectsRef.current.has(key)) return
    buildCompletedProjectsRef.current.add(key)
    setBuildProgress(prev => prev
      ? { ...prev, completed: Math.min(prev.total, buildCompletedProjectsRef.current.size) }
      : prev)
  }

  const trackBuildProgress = (data: string) => {
    if (runningKindRef.current !== 'build' || buildTotalRef.current === 0) return
    const parts = (buildOutputBufferRef.current + data).split('\n')
    buildOutputBufferRef.current = parts.pop() ?? ''
    for (const rawLine of parts) {
      const line = rawLine.replace(/\r/g, '')
      if (!/\s->\s/.test(line)) continue
      const project = buildProjectNamesRef.current.find(name => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`(?:^|[\\\\/\\s])${escaped}(?:\\.csproj)?\\s*->`, 'i').test(line)
      })
      if (project) markCompiledProject(project)
      else if (buildTotalRef.current === 1) markCompiledProject('__project__')
    }
  }

  const startQuickCmd = async (kind: 'build' | 'run') => {
    const cmds = commandsFor()
    if (!rootPath || !cmds || isRunning) return
    const { c, a } = cmds[kind]
    runningKindRef.current = kind
    browserOpenedRef.current = false
    buildOutputBufferRef.current = ''
    buildCompletedProjectsRef.current.clear()
    buildProjectNamesRef.current = solutionProjects.map(p => p.name)
    buildTotalRef.current = kind === 'build' && projectKind === 'dotnet'
      ? Math.max(solutionProjects.length, 1)
      : 0
    setBuildProgress(buildTotalRef.current > 0 ? { completed: 0, total: buildTotalRef.current } : null)
    setQuickOutput([{ level: 'info', text: `> ${c} ${a.join(' ')}` }])
    setIsRunning(true)
    setRunningProcessId(null)
    try {
      // Run uses the selected startup project; build uses the whole solution
      // when one is available, so its progress can cover every project.
      const id = await window.electronAPI.process.start(rootPath, c, a)
      setRunningProcessId(id)
    } catch (e) {
      pushOutputLine('error', (e as Error).message)
      setIsRunning(false)
      setBuildProgress(null)
      runningKindRef.current = null
    }
  }

  const stopQuickCmd = async () => {
    if (runningProcessId) {
      await window.electronAPI.process.stop(runningProcessId)
    }
    setRunningProcessId(null)
    setIsRunning(false)
    setBuildProgress(null)
    runningKindRef.current = null
    pushOutputLine('info', '[stopped]')
  }

  const restartQuickCmd = async () => {
    await stopQuickCmd()
    clearOutput()
    await startQuickCmd('run')
  }

  useEffect(() => {
    const unsubOutput = window.electronAPI.process.onOutput((id, data) => {
      appendOutput(data)
      trackBuildProgress(data)
      // once Kestrel is up, open the default browser on the launch page
      if (runningKindRef.current === 'run' && !browserOpenedRef.current) {
        const m = data.match(/Now listening on:\s*(\S+)/)
        if (m && m[1]) {
          browserOpenedRef.current = true
          const base = m[1].replace(/\/+$/, '')
          const launchUrl = launchUrlRef.current
          window.electronAPI.shell.openExternal(launchUrl ? `${base}/${launchUrl.replace(/^\//, '')}` : base).catch(() => {})
        }
      }
    })
    const unsubExit = window.electronAPI.process.onExit((id, code) => {
      const wasBuild = runningKindRef.current === 'build'
      if (wasBuild && code === 0 && buildTotalRef.current > 0) {
        setBuildProgress({ completed: buildTotalRef.current, total: buildTotalRef.current })
      }
      pushOutputLine('info', `[exited ${code ?? '?'}]`)
      setIsRunning(false)
      setRunningProcessId(null)
      runningKindRef.current = null
    })
    return () => { unsubOutput(); unsubExit() }
  }, [])

  // ─── Empty state ───────────────────────────────────
  if (!rootPath) {
    return (
      <PanelContainer>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', gap: '20px', color: 'var(--text-muted)'
        }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <FolderOpen size={28} strokeWidth={1} />
          </div>
          <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
            <p style={{ margin: '0 0 4px', fontSize: 'calc(13px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>open a folder</p>
            <p style={{ margin: 0, fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>to browse and edit files</p>
          </div>
          <button
            onClick={async () => {
              const p = await window.electronAPI.dialog.openFolder()
              if (p) setRootPath(p)
            }}
            style={{
              padding: '8px 20px', background: 'var(--accent-color)',
              color: 'var(--text-inverse)', border: 'none',
              borderRadius: 'var(--radius-md)', cursor: 'pointer',
              fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontWeight: 600, fontFamily: 'var(--font-mono)'
            }}
          >
            open folder
          </button>
        </div>
      </PanelContainer>
    )
  }

  const explorerPane = (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-primary)', overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '2px',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
      }}>
        <LeftTab active={leftPanel === 'explorer'} onClick={() => setLeftPanel('explorer')} title="explorer" data-tip-desc="show the file explorer">
          <FolderTree size={11} />
        </LeftTab>
        <LeftTab active={leftPanel === 'search'} onClick={() => setLeftPanel('search')} title="search (ctrl+shift+f)" data-tip-desc="search across the workspace (Ctrl+Shift+F)">
          <Search size={11} />
        </LeftTab>
        <LeftTab active={leftPanel === 'changes'} onClick={() => setLeftPanel('changes')} title="changes" data-tip-desc="show the changed files of this worktree">
          <GitCompare size={11} />
        </LeftTab>
        <button
          onClick={() => setExplorerVisible(false)}
          title="collapse panel" data-tip-desc="collapse this side panel to save space"
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center',
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', padding: '6px'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          <PanelLeftClose size={12} />
        </button>
      </div>
      {leftPanel === 'explorer' ? (
        <>
          <FileFilterBar
            value={fileFilter}
            onChange={setFileFilter}
            mode={filterMode}
            onModeChange={setFilterMode}
            caseSensitive={filterCaseSensitive}
            onCaseToggle={() => setFilterCaseSensitive(!filterCaseSensitive)}
            spaceSensitive={filterSpaceSensitive}
            onSpaceToggle={() => setFilterSpaceSensitive(!filterSpaceSensitive)}
          />
          <FileTree rootPath={rootPath} onFileSelect={(f) => openFile(f)} selectedFile={activeFile} filter={filter} />
        </>
      ) : leftPanel === 'changes' ? (
        <ChangesPanel
          repoPath={rootPath}
          onOpenDiff={(original, modified, path) => setDiffView({ original, modified, path })}
        />
      ) : (
        <GlobalSearch rootPath={rootPath} onOpenResult={(f, line) => openFile(f, line)} />
      )}
    </div>
  )

  const editorPane = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {!explorerVisible && (
        <div style={{
          display: 'flex', gap: '2px', padding: '2px 4px',
          borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
        }}>
          <button
            onClick={() => setExplorerVisible(true)}
            title="show explorer" data-tip-desc="show the file explorer panel"
            style={{
              display: 'flex', alignItems: 'center', background: 'none',
              border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <PanelLeftOpen size={12} />
          </button>
        </div>
      )}

      {/* ─── Tabs + Zoom ──────────────────────── */}
      <div style={{
        display: 'flex', overflow: 'hidden', flexShrink: 0,
        background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-subtle)'
      }}>
        {openFiles.length > 0 && (
          <div style={{
            display: 'flex', overflow: 'auto', flex: 1
          }}>
            {openFiles.map(f => {
              const isActive = f.path === activeFile
              const name = f.path.split(/[/\\]/).pop() || f.path
              return (
                <div
                  key={f.path}
                  onClick={() => { setActiveFile(f.path); setDiffView(null) }}
                  title={f.path}
                  data-tip-desc="open this file in the editor"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '5px 8px 5px 12px', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
                    fontFamily: 'var(--font-mono)', cursor: 'pointer',
                    background: isActive ? 'var(--bg-card)' : 'transparent',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                    borderRight: '1px solid var(--border-subtle)',
                    borderTop: isActive ? '1px solid var(--accent-color)' : '1px solid transparent',
                    whiteSpace: 'nowrap', userSelect: 'none', flexShrink: 0
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = 'var(--text-muted)' }}
                >
                  <FileTypeIcon path={f.path} size={10} />
                  {name}
                  {f.dirty && <Circle size={6} fill="var(--accent-color)" style={{ color: 'var(--accent-color)' }} />}
                  <button
                    onClick={(e) => closeFile(f.path, e)}
                    title="close file" data-tip-desc="close this tab without saving"
                    style={{
                      display: 'flex', background: 'none', border: 'none',
                      color: 'var(--text-muted)', cursor: 'pointer', padding: '1px',
                      borderRadius: '2px'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
                  >
                    <X size={10} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {isMarkdownActive && (
          <button onClick={() => setMdPreview(p => !p)}
            title={mdPreview ? 'show source' : 'preview rendered markdown'} data-tip-desc={mdPreview ? 'show the markdown source code' : 'render the markdown preview'}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px',
              background: mdPreview ? 'var(--accent-bg)' : 'transparent',
              border: 'none', color: mdPreview ? 'var(--accent-color)' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))',
              fontFamily: 'var(--font-mono)', fontWeight: 600, flexShrink: 0
            }}
            onMouseEnter={(e) => { if (!mdPreview) e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { if (!mdPreview) e.currentTarget.style.color = 'var(--text-muted)' }}>
            <Eye size={11} />
            {mdPreview ? 'source' : 'preview'}
          </button>
        )}
        {rootPath && (
          <div style={{ display: 'flex', gap: '1px', flexShrink: 0, padding: '0 2px', alignItems: 'center' }}>
            {projectKind === 'dotnet' && solutionProjects.length > 1 && (
              <select
                value={startupProject?.relative ?? ''}
                onChange={(e) => handleStartupProjectChange(e.target.value)}
                 title="startup project" data-tip-desc="the .NET project used by run; solution build includes every project"
                style={{
                  maxWidth: '140px', padding: '1px 4px', fontSize: 'calc(9px * var(--ui-text-scale, 1))',
                  fontFamily: 'var(--font-mono)', background: 'var(--bg-input)',
                  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)', outline: 'none', boxSizing: 'border-box'
                }}
              >
                {solutionProjects.map(p => (
                  <option key={p.relative} value={p.relative} title={p.relative}>{p.name}</option>
                ))}
              </select>
            )}
            {projectKind === 'dotnet' && launchProfiles.length > 0 && (
              <select
                value={launchProfile ?? ''}
                onChange={(e) => handleLaunchProfileChange(e.target.value)}
                title="launch profile" data-tip-desc="the launchSettings.json profile used by run (saved per solution)"
                style={{
                  maxWidth: '140px', padding: '1px 4px', fontSize: 'calc(9px * var(--ui-text-scale, 1))',
                  fontFamily: 'var(--font-mono)', background: 'var(--bg-input)',
                  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)', outline: 'none', boxSizing: 'border-box'
                }}
              >
                {launchProfiles.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            )}
            <button onClick={() => startQuickCmd('build')} disabled={isRunning} title="build" data-tip-desc="build the solution or project (dotnet build)"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '22px', height: '18px', padding: 0,
                background: 'transparent', border: '1px solid transparent',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                opacity: isRunning ? 0.4 : 1
              }}
              onMouseEnter={(e) => { if (!isRunning) e.currentTarget.style.color = 'var(--accent-color)' }}
              onMouseLeave={(e) => { if (!isRunning) e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <Hammer size={11} />
            </button>
            <button onClick={() => startQuickCmd('run')} disabled={isRunning} title="run" data-tip-desc="run the startup project with the selected launch profile"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '22px', height: '18px', padding: 0,
                background: 'transparent', border: '1px solid transparent',
                borderRadius: 'var(--radius-sm)', color: 'var(--success-color)',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                opacity: isRunning ? 0.4 : 1
              }}
              onMouseEnter={(e) => { if (!isRunning) e.currentTarget.style.color = 'var(--accent-color)' }}
              onMouseLeave={(e) => { if (!isRunning) e.currentTarget.style.color = 'var(--success-color)' }}
            >
              <Play size={11} />
            </button>
            <button onClick={stopQuickCmd} disabled={!isRunning} title="stop" data-tip-desc="stop the running process"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '22px', height: '18px', padding: 0,
                background: 'transparent', border: '1px solid transparent',
                borderRadius: 'var(--radius-sm)', color: 'var(--error-color)',
                cursor: isRunning ? 'pointer' : 'not-allowed',
                opacity: isRunning ? 1 : 0.4
              }}
              onMouseEnter={(e) => { if (isRunning) e.currentTarget.style.color = 'var(--error-color)' }}
              onMouseLeave={(e) => { if (isRunning) e.currentTarget.style.color = 'var(--error-color)' }}
            >
              <Square size={10} fill="currentColor" />
            </button>
            <button onClick={restartQuickCmd} disabled={!isRunning} title="restart" data-tip-desc="restart the running process"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '22px', height: '18px', padding: 0,
                background: 'transparent', border: '1px solid transparent',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
                cursor: isRunning ? 'pointer' : 'not-allowed',
                opacity: isRunning ? 1 : 0.4
              }}
              onMouseEnter={(e) => { if (isRunning) e.currentTarget.style.color = 'var(--accent-color)' }}
              onMouseLeave={(e) => { if (isRunning) e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <RotateCw size={11} />
            </button>
          </div>
        )}
        {activeFile?.toLowerCase().endsWith('.cs') && roslynStatus !== 'off' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', flexShrink: 0,
            color: roslynStatus === 'ready' ? 'var(--success-color)' : 'var(--warning-color)',
            borderRight: '1px solid var(--border-subtle)'
          }} title={roslynStatus === 'ready' ? 'C# semantic navigation (Roslyn) attivo' : 'indicizzazione C# in corso…'} data-tip-desc='C# semantic analysis status'>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
            {roslynStatus === 'ready' ? 'roslyn' : 'indexing'}
          </div>
        )}
        {activeFile?.toLowerCase().endsWith('.cs') && roslynStatus === 'ready' && (csErrorCount.errors > 0 || csErrorCount.warnings > 0) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '0 8px',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', flexShrink: 0, whiteSpace: 'nowrap',
            borderRight: '1px solid var(--border-subtle)'
          }}>
            {csErrorCount.errors > 0 && (
              <span style={{ color: 'var(--error-color)', display: 'flex', alignItems: 'center', gap: '3px' }} title={`${csErrorCount.errors} errori`} data-tip-desc="compiler errors in the active file">
                <XCircle size={10} /> {csErrorCount.errors}
              </span>
            )}
            {csErrorCount.warnings > 0 && (
              <span style={{ color: 'var(--warning-color)', display: 'flex', alignItems: 'center', gap: '3px' }} title={`${csErrorCount.warnings} warning`} data-tip-desc="compiler warnings in the active file">
                <AlertTriangle size={10} /> {csErrorCount.warnings}
              </span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: '1px', flexShrink: 0, padding: '0 2px', borderRight: '1px solid var(--border-subtle)' }}>
          <button onClick={goBack} disabled={navBackRef.current.length === 0} title="back (Ctrl+-)" data-tip-desc="navigate to the previous location (Ctrl+-)"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '18px', padding: 0,
              background: 'transparent', border: '1px solid transparent',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
              cursor: navBackRef.current.length === 0 ? 'not-allowed' : 'pointer',
              opacity: navBackRef.current.length === 0 ? 0.4 : 1
            }}
            onMouseEnter={(e) => { if (navBackRef.current.length > 0) e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { if (navBackRef.current.length > 0) e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <ArrowLeft size={11} />
          </button>
          <button onClick={goForward} disabled={navForwardRef.current.length === 0} title="forward (Ctrl+Shift+-)" data-tip-desc="navigate to the next location (Ctrl+Shift+-)"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '18px', padding: 0,
              background: 'transparent', border: '1px solid transparent',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
              cursor: navForwardRef.current.length === 0 ? 'not-allowed' : 'pointer',
              opacity: navForwardRef.current.length === 0 ? 0.4 : 1
            }}
            onMouseEnter={(e) => { if (navForwardRef.current.length > 0) e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { if (navForwardRef.current.length > 0) e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <ArrowRight size={11} />
          </button>
        </div>
        <ZoomControls fontSize={fontSize} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={zoomReset} />
      </div>

      {rootPath && (
        <GitBar
          repoPath={rootPath}
          activeFile={activeFile}
          onShowText={(title, text) => setGitModal({ title, text })}
          onShowBlame={(blame) => setGitModal({ title: 'git blame', blame })}
          onShowHistory={(history) => setGitModal({ title: 'git history', history })}
        />
      )}

      {/* ─── Editor / Diff area ───────────────── */}
      <div style={{ flex: 1, minHeight: 0, background: 'var(--bg-card)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {diffView ? (
          <DiffViewer
            original={diffView.original}
            modified={diffView.modified}
            filePath={diffView.path}
            onClose={() => setDiffView(null)}
          />
        ) : activeFile && isMarkdownActive && mdPreview ? (
          <MarkdownView content={activeContent} />
        ) : activeFile ? (
          <Editor
            height="100%"
            path={activeFile}
            language={detectLang(activeFile)}
            theme={theme === 'dark' ? THEME_DARK : THEME_LIGHT}
            value={activeContent}
            onChange={(v) => updateContent(v || '')}
            onMount={handleEditorMount}
            options={{
              fontSize,
              fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
              fontLigatures: settings.fontLigatures,
              mouseWheelZoom: true,
              minimap: { enabled: settings.minimap, maxColumn: 80, renderCharacters: false },
              lineNumbers: settings.lineNumbers,
              renderWhitespace: 'selection',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 10 },
              tabSize: settings.tabSize,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              smoothScrolling: true,
              bracketPairColorization: { enabled: true },
              guides: { indentation: true, bracketPairs: true },
              find: { addExtraSpaceOnTop: false, seedSearchStringFromSelection: 'selection' },
              hover: { enabled: 'on', delay: 500 },
              folding: true,
              foldingHighlight: true,
              showFoldingControls: 'mouseover',
              glyphMargin: true,
              lineDecorationsWidth: 10,
              renderLineHighlight: 'all',
              stickyScroll: { enabled: true, maxLineCount: 5 },
              occurrencesHighlight: 'singleFile',
              selectionHighlight: true,
              suggestOnTriggerCharacters: true,
              wordBasedSuggestions: 'currentDocument',
              wordWrap: settings.wordWrap,
              scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
            }}
          />
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: '14px',
            color: 'var(--text-muted)', fontFamily: 'var(--font-mono)'
          }}>
            <FileCode size={32} strokeWidth={1} />
            <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', textAlign: 'center', lineHeight: 1.8 }}>
              select a file from the explorer<br />
              <span style={{ color: 'var(--text-muted)', fontSize: 'calc(9px * var(--ui-text-scale, 1))' }}>
                ctrl+f find in file · ctrl+shift+f search all files · ctrl+s save
              </span>
            </div>
          </div>
        )}
      </div>
      {quickOutput !== null && (
        <div style={{
          flexShrink: 0, maxHeight: '35%', height: '180px',
          borderTop: '1px solid var(--accent-color)',
          display: 'flex', flexDirection: 'column'
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '3px 8px', background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>
              {isRunning && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />}
              {isRunning ? 'running...' : 'output'}
            </span>
            {isRunning && runningKindRef.current === 'build' && buildProgress && (
              <div title={`compiled projects: ${buildProgress.completed}/${buildProgress.total}`} data-tip-desc="build progress based on completed projects"
                style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: '110px', maxWidth: '180px', flexShrink: 0 }}>
                <div style={{ flex: 1, height: '5px', overflow: 'hidden', borderRadius: '3px', background: 'var(--bg-tag)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ width: `${Math.round((buildProgress.completed / buildProgress.total) * 100)}%`, height: '100%', background: 'var(--accent-color)', transition: 'width 0.2s ease' }} />
                </div>
                <span style={{ color: 'var(--accent-color)', fontSize: 'calc(8px * var(--ui-text-scale, 1))', whiteSpace: 'nowrap' }}>
                  {buildProgress.completed}/{buildProgress.total}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', gap: '3px', flex: 1, minWidth: 0, overflow: 'hidden' }}>
              {(['info', 'trace', 'warn', 'error'] as OutputLevel[]).map(level => {
                const active = outputFilter[level]
                const count = quickOutput.filter(e => e.level === level).length
                return (
                  <button
                    key={level}
                    onClick={() => setOutputFilter(f => ({ ...f, [level]: !f[level] }))}
                    title={`${active ? 'hide' : 'show'} ${level} messages`}
                    data-tip-desc={`${active ? 'hide' : 'show'} the ${level} messages in the output`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '3px', padding: '1px 6px', height: '16px',
                      background: active ? 'var(--bg-tag)' : 'transparent',
                      border: `1px solid ${active ? OUTPUT_LEVEL_COLORS[level] : 'var(--border-color)'}`,
                      borderRadius: 'var(--radius-sm)', color: active ? OUTPUT_LEVEL_COLORS[level] : 'var(--text-muted)',
                      cursor: 'pointer', fontSize: 'calc(8px * var(--ui-text-scale, 1))',
                      fontFamily: 'var(--font-mono)', fontWeight: 600, flexShrink: 0
                    }}
                  >
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: OUTPUT_LEVEL_COLORS[level], display: 'inline-block' }} />
                    {level} {count}
                  </button>
                )
              })}
            </div>
            <button onClick={copyOutput} title="copy output" data-tip-desc="copy all the output text to the clipboard (Ctrl+C)"
              style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
              <Copy size={10} />
            </button>
            <button onClick={() => setQuickOutput(null)} title="close output" data-tip-desc="close the command output panel"
              style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '1px', flexShrink: 0 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
              <X size={10} />
            </button>
          </div>
          <pre
            ref={outputAreaRef}
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                e.preventDefault()
                copyOutput()
              }
            }}
            style={{
              flex: 1, overflow: 'auto', margin: 0, padding: '6px 10px', outline: 'none',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--text-primary)', background: 'var(--bg-card)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all'
            }}
          >
            {quickOutput.filter(e => outputFilter[e.level]).map((e, i) => (
              <div key={i} style={{ color: OUTPUT_LEVEL_COLORS[e.level] }}>{e.text}</div>
            ))}
          </pre>
        </div>
      )}
        </div>
        <TerminalDock repoPath={rootPath} />
    </div>
  )

  return (
    <PanelContainer>
      <div style={{
        height: '100%',
        background: 'var(--bg-card)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)', overflow: 'hidden'
      }}>
        <ResizableSplitter
          direction="horizontal"
          defaultSize={240}
          minSize={150}
          maxSize={500}
          collapsed={!explorerVisible}
        >
          {explorerPane}
          {editorPane}
        </ResizableSplitter>
      </div>
      {ctxMenu?.show && (
        <EditorContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          lineNumber={ctxMenu.lineNumber}
          symbol={ctxMenu.symbol}
          isModified={ctxMenu.isModified}
          onGoDefinition={() => { setCtxMenu(null); goToSymbol('definition', ctxMenu.symbol || undefined) }}
          onGoImplementation={() => { setCtxMenu(null); goToSymbol('implementation', ctxMenu.symbol || undefined) }}
          onFindReferences={() => { setCtxMenu(null); findReferences(ctxMenu.symbol || undefined) }}
          onRevertLine={revertLine}
          onRevertBlock={revertBlock}
          onClose={closeCtxMenu}
        />
      )}
      {referencesModal && (
        <ReferencesModal
          symbol={referencesModal.symbol}
          hits={referencesModal.hits}
          rootPath={rootPath}
          onClose={() => setReferencesModal(null)}
          onNavigate={(file, line) => { setReferencesModal(null); openFileRef.current(file, line) }}
        />
      )}
      {implPicker && (
        <ReferencesModal
          symbol={implPicker.symbol}
          hits={implPicker.hits}
          title="implementation" data-tip-desc="go to the implementation of the symbol"
          rootPath={rootPath}
          onClose={() => setImplPicker(null)}
          onNavigate={(file, line) => { setImplPicker(null); openFileRef.current(file, line) }}
        />
      )}
      {gitModal && (
        <GitModal title={gitModal.title} text={gitModal.text} blame={gitModal.blame} history={gitModal.history} onClose={() => setGitModal(null)} />
      )}
    </PanelContainer>
  )
}

// ANSI SGR → colored spans using theme variables (used for build/run output)
function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {  return (
    <div
      style={{
        padding: '5px 14px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', cursor: 'pointer',
        color: danger ? 'var(--error-color)' : 'var(--text-primary)',
        whiteSpace: 'nowrap' as const, transition: 'background 0.1s ease'
      }}
      onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'var(--error-bg)' : 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {label}
    </div>
  )
}

function EditorContextMenu({ x, y, lineNumber, symbol, onGoDefinition, onGoImplementation, onFindReferences, onRevertLine, onRevertBlock }: {
  x: number; y: number; lineNumber: number
  symbol: string | null
  isModified: boolean
  onClose: () => void
  onGoDefinition: () => void
  onGoImplementation: () => void
  onFindReferences: () => void
  onRevertLine: (line: number) => void
  onRevertBlock: (line: number) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  // pages in the SAME space; the mouse wheel switches between them
  const pages: { label: string; onClick: () => void; danger?: boolean }[][] = []
  const symbolPage = symbol ? [
    { label: `Go to Definition — ${symbol}`, onClick: onGoDefinition },
    { label: `Go to Implementation — ${symbol}`, onClick: onGoImplementation },
    { label: `Find All References — ${symbol}`, onClick: onFindReferences }
  ] : []
  if (symbolPage.length > 0) pages.push(symbolPage)
  // page 2 is always present when a symbol is shown, so the wheel can switch to it
  pages.push([
    { label: 'Revert this line', onClick: () => onRevertLine(lineNumber) },
    { label: 'Revert modified block', onClick: () => onRevertBlock(lineNumber) }
  ])
  const [page, setPage] = useState(0)
  const count = pages.length
  const current = pages[Math.min(page, count - 1)]

  // native non-passive wheel listener: React registers onWheel as passive, so
  // preventDefault (blocking scroll under the menu) and reliable page switching
  // need a direct listener on the menu node
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setPage(p => (p + (e.deltaY > 0 ? 1 : -1) + count) % count)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [count])

  return (
    <div ref={menuRef} data-role="editor-ctx-menu" style={{
      position: 'fixed', left: x, top: y, zIndex: 10001,
      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      padding: '4px 0', minWidth: '200px', display: 'flex', flexDirection: 'column'
    }}>
      {current.map((item, i) => (
        <MenuItem key={i} label={item.label} onClick={item.onClick} danger={item.danger} />
      ))}
      {count > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
          padding: '4px 8px', borderTop: '1px solid var(--border-subtle)', marginTop: '2px'
        }}>
          {pages.map((_, i) => (
            <span key={i} style={{
              width: '5px', height: '5px', borderRadius: '50%', display: 'inline-block',
              background: i === page ? 'var(--accent-color)' : 'var(--text-muted)'
            }} />
          ))}
          <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', marginLeft: '4px' }}>
            {page + 1}/{count}
          </span>
        </div>
      )}
    </div>
  )
}

function LeftTab(props: { active: boolean; onClick: () => void; title: string; children: React.ReactNode; 'data-tip-desc'?: string }) {
  const { active, onClick, title, children, 'data-tip-desc': tipDesc } = props
  return (
    <button
      onClick={onClick}
      title={title}
      data-tip-desc={tipDesc}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '7px 12px', background: 'transparent', border: 'none',
        borderBottom: active ? '1.5px solid var(--accent-color)' : '1.5px solid transparent',
        color: active ? 'var(--accent-color)' : 'var(--text-muted)',
        cursor: 'pointer', transition: 'color 0.15s ease'
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-muted)' }}
    >
      {children}
    </button>
  )
}

export function FileFilterBar({ value, onChange, mode, onModeChange, caseSensitive, onCaseToggle, spaceSensitive, onSpaceToggle }: {
  value: string
  onChange: (v: string) => void
  mode: 'startsWith' | 'like' | 'regex'
  onModeChange: (m: 'startsWith' | 'like' | 'regex') => void
  caseSensitive: boolean
  onCaseToggle: () => void
  spaceSensitive: boolean
  onSpaceToggle: () => void
}) {
  return (
    <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="filter files..."
        spellCheck={false}
        style={{
          width: '100%', padding: '3px 6px', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
          fontFamily: 'var(--font-mono)', background: 'var(--bg-input)',
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box'
        }}
      />
      <div style={{ display: 'flex', gap: '2px', marginTop: '3px' }}>
        <FToggle active={mode === 'startsWith'} onClick={() => onModeChange('startsWith')} title="starts with" data-tip-desc="filter mode: starts with" icon={<ChevronRight size={10} />} />
        <FToggle active={mode === 'like'} onClick={() => onModeChange('like')} title="contains" data-tip-desc="filter mode: contains" icon={<Asterisk size={10} />} />
        <FToggle active={mode === 'regex'} onClick={() => onModeChange('regex')} title="regex" data-tip-desc="filter mode: regular expression" icon={<Regex size={10} />} />
        <FToggle active={caseSensitive} onClick={onCaseToggle} title="case sensitive" data-tip-desc="match the exact case" icon={<CaseSensitive size={10} />} />
        <FToggle active={spaceSensitive} onClick={onSpaceToggle} title="match spaces" data-tip-desc="keep spaces significant in the filter" icon={<SeparatorHorizontal size={10} />} />
      </div>
    </div>
  )
}

function FToggle(props: { active: boolean; onClick: () => void; title: string; icon: React.ReactNode; 'data-tip-desc'?: string }) {
  const { active, onClick, title, icon, 'data-tip-desc': tipDesc } = props
  return (
    <button onClick={onClick} title={title} data-tip-desc={tipDesc} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '22px', height: '18px', padding: 0,
      background: active ? 'var(--bg-active)' : 'transparent',
      border: active ? '1px solid var(--accent-color)' : '1px solid transparent',
      borderRadius: 'var(--radius-sm)',
      color: active ? 'var(--accent-color)' : 'var(--text-muted)',
      cursor: 'pointer', transition: 'all 0.15s ease'
    }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-muted)' }}>
      {icon}
    </button>
  )
}

export function ZoomControls({ fontSize, onZoomIn, onZoomOut, onReset }: {
  fontSize: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}) {
  const btnStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '20px', height: '18px', padding: 0,
    background: 'transparent', border: '1px solid transparent',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
    cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'calc(11px * var(--ui-text-scale, 1))',
    fontWeight: 600, transition: 'color 0.15s ease'
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '1px',
      padding: '3px 6px', flexShrink: 0
    }}>
      <button style={btnStyle} onClick={onZoomOut} title="zoom out (ctrl+-)" data-tip-desc="decrease the font size (Ctrl+-)"
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>−</button>
      <span onClick={onReset} title="reset zoom (ctrl+0)" data-tip-desc="reset the font size to default (Ctrl+0)" style={{
        fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)', cursor: 'pointer',
        minWidth: '28px', textAlign: 'center', userSelect: 'none'
      }}>{Math.round(fontSize)}px</span>
      <button style={btnStyle} onClick={onZoomIn} title="zoom in (ctrl++)" data-tip-desc="increase the font size (Ctrl++)"
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>+</button>
    </div>
  )
}
