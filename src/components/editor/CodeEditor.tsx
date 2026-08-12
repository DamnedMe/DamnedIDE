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
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import { defineThemes, THEME_DARK, THEME_LIGHT, patchCSharpGrammar } from './monaco-theme'
import { useEditorStore, useWorktreeStore, useUIStore, useSettingsStore } from '../../store'
import {
  FileCode, FolderOpen, X, Circle,
  PanelLeftClose, PanelLeftOpen, FolderTree, Search,
  ChevronRight, Asterisk, Regex, CaseSensitive, SeparatorHorizontal,
  Play, Hammer, Square, RotateCw, GitCompare,
  ArrowLeft, ArrowRight, XCircle, AlertTriangle
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

export function CodeEditor() {
  const [rootPath, setRootPath] = useState<string | null>(null)
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
  const [quickOutput, setQuickOutput] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runningProcessId, setRunningProcessId] = useState<string | null>(null)
  const [gitModal, setGitModal] = useState<{ title: string; text?: string; blame?: { hash: string; author: string; date: string; line: string }[]; history?: { hash: string; date: string; message: string; authorName: string }[] } | null>(null)
  const openFileRef = useRef<(f: string, l?: number, fromNavigation?: boolean) => void>(() => {})
  const rootPathRef = useRef<string | null>(null)
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
    if (wt && !rootPath) {
      setRootPath(wt)
      setExplorerVisible(true)
      setLeftPanel('explorer')
    }
  }, [])

  activeFileRef.current = activeFile
  rootPathRef.current = rootPath

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

  useEffect(() => {
    if (!rootPath) { setProjectKind(null); setDotnetProject(null); return }
    window.electronAPI.fs.readDir(rootPath)
      .then(async entries => {
        const csproj = entries.find(e => e.isFile && e.name.endsWith('.csproj'))
        const hasSln = entries.some(e => e.isFile && e.name.endsWith('.sln'))
        const hasPackage = entries.some(e => e.isFile && e.name === 'package.json')
        if (csproj) {
          setProjectKind('dotnet')
          setDotnetProject(`${rootPath}\\${csproj.name}`)
          return
        }
        if (hasPackage) {
          setProjectKind('node')
          setDotnetProject(null)
          return
        }
        if (hasSln) {
          // No csproj at root: search one level deep for a project
          const dirs = entries.filter(e => e.isDirectory)
          for (const d of dirs) {
            try {
              const sub = await window.electronAPI.fs.readDir(`${rootPath}\\${d.name}`)
              const subCs = sub.find(e => e.isFile && e.name.endsWith('.csproj'))
              if (subCs) {
                setProjectKind('dotnet')
                setDotnetProject(`${rootPath}\\${d.name}\\${subCs.name}`)
                return
              }
            } catch { /* ignore */ }
          }
          setProjectKind('dotnet')
          setDotnetProject(null)
          return
        }
        setProjectKind(null)
        setDotnetProject(null)
      })
      .catch(() => { setProjectKind(null); setDotnetProject(null) })
  }, [rootPath])

  const commandsFor = (): { build: { c: string; a: string[] }; run: { c: string; a: string[] } } | null => {
    if (!rootPath || !projectKind) return null
    if (projectKind === 'dotnet') {
      return { build: { c: 'dotnet', a: ['build'] }, run: { c: 'dotnet', a: ['run'] } }
    }
    return { build: { c: 'npm', a: ['run', 'build'] }, run: { c: 'npm', a: ['run', 'dev'] } }
  }

  const startQuickCmd = async (kind: 'build' | 'run') => {
    const cmds = commandsFor()
    if (!rootPath || !cmds || isRunning) return
    const { c, a } = cmds[kind]
    setQuickOutput(`\x1b[36m> ${c} ${a.join(' ')}\x1b[0m\r\n`)
    setIsRunning(true)
    setRunningProcessId(null)
    try {
      // Run dotnet in the project's directory so it finds the .csproj automatically
      const cwd = projectKind === 'dotnet' && dotnetProject
        ? dotnetProject.replace(/[\\/][^\\/]*$/, '')
        : rootPath
      const id = await window.electronAPI.process.start(cwd, c, a)
      setRunningProcessId(id)
    } catch (e) {
      setQuickOutput(prev => (prev || '') + `\r\n\x1b[31m${(e as Error).message}\x1b[0m\r\n`)
      setIsRunning(false)
    }
  }

  const stopQuickCmd = async () => {
    if (runningProcessId) {
      await window.electronAPI.process.stop(runningProcessId)
    }
    setRunningProcessId(null)
    setIsRunning(false)
    setQuickOutput(prev => (prev || '') + `\r\n\x1b[33m[stopped]\x1b[0m\r\n`)
  }

  const restartQuickCmd = async () => {
    await stopQuickCmd()
    setQuickOutput(null)
    await startQuickCmd('run')
  }

  useEffect(() => {
    const unsubOutput = window.electronAPI.process.onOutput((id, data) => {
      setQuickOutput(prev => {
        if (!prev) return data
        return prev.length > 200000 ? prev.slice(-200000) + data : prev + data
      })
    })
    const unsubExit = window.electronAPI.process.onExit((id, code) => {
      setQuickOutput(prev => (prev || '') + `\r\n\x1b[33m[exited ${code ?? '?'}]\x1b[0m\r\n`)
      setIsRunning(false)
      setRunningProcessId(null)
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
        <LeftTab active={leftPanel === 'explorer'} onClick={() => setLeftPanel('explorer')} title="explorer">
          <FolderTree size={11} />
        </LeftTab>
        <LeftTab active={leftPanel === 'search'} onClick={() => setLeftPanel('search')} title="search (ctrl+shift+f)">
          <Search size={11} />
        </LeftTab>
        <LeftTab active={leftPanel === 'changes'} onClick={() => setLeftPanel('changes')} title="changes">
          <GitCompare size={11} />
        </LeftTab>
        <button
          onClick={() => setExplorerVisible(false)}
          title="collapse panel"
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
            title="show explorer"
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
        {rootPath && (
          <div style={{ display: 'flex', gap: '1px', flexShrink: 0, padding: '0 2px' }}>
            <button onClick={() => startQuickCmd('build')} disabled={isRunning} title="build"
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
            <button onClick={() => startQuickCmd('run')} disabled={isRunning} title="run"
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
            <button onClick={stopQuickCmd} disabled={!isRunning} title="stop"
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
            <button onClick={restartQuickCmd} disabled={!isRunning} title="restart"
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
          }} title={roslynStatus === 'ready' ? 'C# semantic navigation (Roslyn) attivo' : 'indicizzazione C# in corso…'}>
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
              <span style={{ color: 'var(--error-color)', display: 'flex', alignItems: 'center', gap: '3px' }} title={`${csErrorCount.errors} errori`}>
                <XCircle size={10} /> {csErrorCount.errors}
              </span>
            )}
            {csErrorCount.warnings > 0 && (
              <span style={{ color: 'var(--warning-color)', display: 'flex', alignItems: 'center', gap: '3px' }} title={`${csErrorCount.warnings} warning`}>
                <AlertTriangle size={10} /> {csErrorCount.warnings}
              </span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: '1px', flexShrink: 0, padding: '0 2px', borderRight: '1px solid var(--border-subtle)' }}>
          <button onClick={goBack} disabled={navBackRef.current.length === 0} title="back (Ctrl+-)"
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
          <button onClick={goForward} disabled={navForwardRef.current.length === 0} title="forward (Ctrl+Shift+-)"
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
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '3px 8px', background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
          }}>
            <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 600 }}>
              {isRunning ? 'running...' : 'output'}
            </span>
            <button onClick={() => setQuickOutput(null)}
              style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '1px' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
              <X size={10} />
            </button>
          </div>
          <pre style={{
            flex: 1, overflow: 'auto', margin: 0, padding: '6px 10px',
            fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--text-primary)', background: 'var(--bg-card)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all'
          }}>{renderAnsi(quickOutput)}</pre>
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
          title="implementation"
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
function renderAnsi(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const re = /\x1b\[([0-9;]*)m/g
  let last = 0
  let color: string | undefined
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(<span key={key++} style={{ color }}>{text.slice(last, m.index)}</span>)
    const codes = m[1].split(';')
    if (codes.includes('0')) color = undefined
    else if (codes.includes('31')) color = 'var(--error-color)'
    else if (codes.includes('32')) color = 'var(--success-color)'
    else if (codes.includes('33')) color = 'var(--warning-color)'
    else if (codes.includes('36')) color = 'var(--accent-color)'
    last = re.lastIndex
  }
  if (last < text.length) nodes.push(<span key={key++} style={{ color }}>{text.slice(last)}</span>)
  return nodes
}

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

function LeftTab({ active, onClick, title, children }: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
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
        <FToggle active={mode === 'startsWith'} onClick={() => onModeChange('startsWith')} title="starts with" icon={<ChevronRight size={10} />} />
        <FToggle active={mode === 'like'} onClick={() => onModeChange('like')} title="contains" icon={<Asterisk size={10} />} />
        <FToggle active={mode === 'regex'} onClick={() => onModeChange('regex')} title="regex" icon={<Regex size={10} />} />
        <FToggle active={caseSensitive} onClick={onCaseToggle} title="case sensitive" icon={<CaseSensitive size={10} />} />
        <FToggle active={spaceSensitive} onClick={onSpaceToggle} title="match spaces" icon={<SeparatorHorizontal size={10} />} />
      </div>
    </div>
  )
}

function FToggle({ active, onClick, title, icon }: {
  active: boolean; onClick: () => void; title: string; icon: React.ReactNode
}) {
  return (
    <button onClick={onClick} title={title} style={{
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
      <button style={btnStyle} onClick={onZoomOut} title="zoom out (ctrl+-)"
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>−</button>
      <span onClick={onReset} title="reset zoom (ctrl+0)" style={{
        fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)', cursor: 'pointer',
        minWidth: '28px', textAlign: 'center', userSelect: 'none'
      }}>{Math.round(fontSize)}px</span>
      <button style={btnStyle} onClick={onZoomIn} title="zoom in (ctrl++)"
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>+</button>
    </div>
  )
}
