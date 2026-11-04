import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import { GitFileStatus } from '../../types/git'
import { FileDiffList } from '../git/FileDiffList'
import { DiffViewer } from '../editor/DiffViewer'
import type { DiffViewerHandle } from '../editor/DiffViewer'
import { useEditorStore } from '../../store'
import { Modal } from '../layout/Modal'
import { Loader2, AlertCircle, GitCompare, RefreshCw, Pencil, Save, X, ListPlus, GitMerge, Eye, GitCommitHorizontal, Download, Upload, Check, ArrowRightLeft, AlertTriangle, Undo2 } from 'lucide-react'
import { MergeTool } from './MergeTool'
import { MarkdownView } from '../editor/MarkdownView'
import Editor from '@monaco-editor/react'
import { defineThemes, THEME_DARK, THEME_LIGHT, patchCSharpGrammar } from '../editor/monaco-theme'
import { useUIStore, useSettingsStore, useToastStore } from '../../store'
import { applyCSharpDiagnostics, clearCSharpDiagnostics, scheduleCSharpDiagnostics } from '../../utils/csharp-diagnostics'
import { registerCSharpHover, trackHoverModel } from '../../utils/csharp-hover'
import { joinPath } from '../../utils/paths'
import { appFontStack } from '../../utils/fonts'
import { FileFilterBar } from '../editor/CodeEditor'
import { compileFileFilter, matchPathOrName } from '../../utils/file-filter'
import type { FileFilterMode } from '../../utils/file-filter'

function applyEditorTheme(monaco: typeof import('monaco-editor')) {
  const theme = useUIStore.getState().theme
  const themeColors = useSettingsStore.getState().settings.themeColors
  defineThemes(monaco, themeColors)
  patchCSharpGrammar(monaco)
  monaco.editor.setTheme(theme === 'dark' ? THEME_DARK : THEME_LIGHT)
}

interface WorktreeChangesProps {
  worktreePath: string
  repoPath?: string
  checkMarks: Record<string, 'ok' | 'ko'>
  onToggleCheck: (filePath: string, state: 'ok' | 'ko' | null) => void
  onFileSelected?: (filePath: string | null) => void
  handleRef?: React.MutableRefObject<WorktreeChangesHandle | null>
  /** git state changed (commit, pull, push, transfer, status): the worktree paths touched, undefined = every branch (remote refs moved) */
  onGitChanged?: (paths?: string[]) => void
  /** ahead/behind of this worktree's branch vs its upstream, shown next to pull/push */
  sync?: { ahead: number; behind: number } | null
  /** places the parts: the caller owns the layout, this component keeps the state (and stays mounted) */
  layout: (parts: WorktreeChangesParts) => ReactNode
}

export interface WorktreeChangesParts {
  /** toolbar, commit/transfer forms, filter, conflicts and rows */
  list: ReactNode
  /** diff / edit pane */
  diff: ReactNode
  /** changed files (staged + unstaged) */
  count: number
  /** unresolved conflicts (not in count) */
  conflicts: number
  /** git status unreadable: shown in place of the list */
  statusError: string | null
  /** pull ↓n / push ↑n, gated by the running git operation */
  syncButtons: ReactNode
}

export interface WorktreeChangesHandle {
  openFile: (absPath: string) => void
}

export function WorktreeChanges({ worktreePath, repoPath, checkMarks, onToggleCheck, onFileSelected, handleRef, onGitChanged, sync, layout }: WorktreeChangesProps) {
  const [files, setFiles] = useState<GitFileStatus[]>([])
  const [stagedFiles, setStagedFiles] = useState<GitFileStatus[]>([])
  const [unstagedFiles, setUnstagedFiles] = useState<GitFileStatus[]>([])
  const [unmergedFiles, setUnmergedFiles] = useState<GitFileStatus[]>([])
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffFile, setDiffFile] = useState<string | null>(null)
  const diffFileRef = useRef<string | null>(null)
  const filesRef = useRef<GitFileStatus[]>([])
  const [diffOriginal, setDiffOriginal] = useState('')
  const [diffModified, setDiffModified] = useState('')
  const [isLoadingDiff, setIsLoadingDiff] = useState(false)
  const [isDiffFullscreen, setIsDiffFullscreen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [mdPreview, setMdPreview] = useState(false)
  const [diffInitialLine, setDiffInitialLine] = useState<number | undefined>(undefined)
  const [editedContent, setEditedContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const diffViewerRef = useRef<DiffViewerHandle>(null)
  const pendingScrollLineRef = useRef<number | null>(null)
  // scroll position (top visible line) kept per file, so switching away and
  // back resumes exactly where the file was left
  const scrollLinesRef = useRef<Record<string, number>>({})
  const editEditorRef = useRef<any>(null)
  const setEditorNav = useEditorStore(s => s.setEditorNav)
  const showToast = useToastStore(s => s.showToast)
  const appFont = useSettingsStore(s => s.settings.appFont)
  const appFontSize = useSettingsStore(s => s.settings.fontSize)
  const [isCommitOpen, setIsCommitOpen] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [commitAndPush, setCommitAndPush] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [isMoveOpen, setIsMoveOpen] = useState(false)
  const [moveTargets, setMoveTargets] = useState<{ path: string; branch: string; head: string }[]>([])
  const [moveTarget, setMoveTarget] = useState('')
  const [moveIsMove, setMoveIsMove] = useState(true)
  const [moveStagedOnly, setMoveStagedOnly] = useState(false)
  const [discardTarget, setDiscardTarget] = useState<{ file: string; staged: boolean; untracked: boolean } | null>(null)
  const [isDiscarding, setIsDiscarding] = useState(false)
  // a failed read of the working-tree side, shown instead of an empty diff
  const [diffError, setDiffError] = useState<string | null>(null)
  // file filter on the relative path (regex by default, unanchored); local to
  // the panel, not persisted. Conflicts, stage-all and commit ignore it.
  const [filterText, setFilterText] = useState('')
  const [filterMode, setFilterMode] = useState<FileFilterMode>('regex')
  const [filterCase, setFilterCase] = useState(false)
  const [filterSpace, setFilterSpace] = useState(false)
  const match = useMemo(
    () => compileFileFilter(filterText ? { query: filterText, mode: filterMode, caseSensitive: filterCase, spaceSensitive: filterSpace } : null),
    [filterText, filterMode, filterCase, filterSpace]
  )
  const shown = matchPathOrName(match)
  const visStaged = stagedFiles.filter(f => shown(f.path))
  const visUnstaged = unstagedFiles.filter(f => shown(f.path))
  const visFiles = files.filter(f => shown(f.path))

  const updateEditorNav = (line: number | null) => {
    if (!diffFile || line == null) return
    setEditorNav({ rootPath: worktreePath, filePath: `${worktreePath}/${diffFile}`, line })
  }

  useEffect(() => {
    if (!diffFile) return
    onFileSelected?.(joinPath(worktreePath, diffFile))
  }, [diffFile])

  const loadStatus = useCallback(async (opts?: { keepSelection?: boolean }) => {
    setIsLoading(true)
    setError(null)
    if (!opts?.keepSelection) {
      setDiffFile(null)
      diffFileRef.current = null
      setSelectedIndex(0)
    }
    try {
      const p = await window.electronAPI.git.porcelain(worktreePath)
      const staged = p.staged.map(f => ({
        path: f.path, index: f.changeType === 'add' ? 'A' : f.changeType === 'delete' ? 'D' : 'M', workingDir: ' ',
        staged: true, unstaged: false,
        isNew: f.changeType === 'add', isModified: f.changeType === 'edit', isDeleted: f.changeType === 'delete', isRenamed: false
      }))
      const unstaged = p.unstaged.map(f => ({
        path: f.path, index: f.changeType === 'add' ? '?' : 'M', workingDir: f.changeType === 'add' ? '?' : f.changeType === 'delete' ? 'D' : 'M',
        staged: false, unstaged: true,
        isNew: f.changeType === 'add', isModified: f.changeType === 'edit', isDeleted: f.changeType === 'delete', isRenamed: false
      }))
      const sortByPath = (arr: GitFileStatus[]) => arr.sort((a, b) => a.path.localeCompare(b.path))
      sortByPath(staged)
      sortByPath(unstaged)
      const unmerged = (p.unmerged || []).map(f => ({
        path: f.path, index: f.changeType, workingDir: f.changeType,
        staged: false, unstaged: false, isConflict: true,
        isNew: false, isModified: true, isDeleted: false, isRenamed: false
      }))
      sortByPath(unmerged)
      const combined = [...staged, ...unstaged].sort((a, b) => a.path.localeCompare(b.path))
      filesRef.current = combined
      setStagedFiles(staged)
      setUnstagedFiles(unstaged)
      setUnmergedFiles(unmerged)
      setFiles(combined)
      // a watcher-driven refresh must not steal the file the user is looking at
      if (opts?.keepSelection) {
        const current = diffFileRef.current
        const idx = current ? combined.findIndex(f => f.path === current) : -1
        setSelectedIndex(idx >= 0 ? idx : -1)
      }
    } catch (e) {
      // a background refresh must not replace the panel with an error banner
      if (!opts?.keepSelection) setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [worktreePath])

  useEffect(() => {
    loadStatus()
    setDiffFile(null)
  }, [loadStatus])

  // Working-tree side of the diff. A staged file missing on disk falls back to
  // its index version (as ChangesPanel does); any other failure comes back as
  // an error so the pane says so instead of rendering an empty diff.
  const readModified = async (path: string, staged: boolean): Promise<{ text: string; error: string | null }> => {
    try {
      return { text: await window.electronAPI.fs.readFile(`${worktreePath}/${path}`), error: null }
    } catch (e) {
      const indexed = staged ? await window.electronAPI.git.showRef(worktreePath, path, ':').catch(() => '') : ''
      if (indexed) return { text: indexed, error: null }
      const msg = ((e as Error).message || String(e)).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
      return { text: '', error: `impossibile leggere il file: ${msg}` }
    }
  }
  const noRead = { text: '', error: null }

  // Reload the open diff from disk without touching the current selection.
  const reloadActiveDiff = async () => {
    const path = diffFileRef.current
    if (!path || isEditing) return
    const f = filesRef.current.find(x => x.path === path)
    if (!f) {
      diffFileRef.current = null
      setDiffFile(null)
      return
    }
    const needsOriginal = !f.isNew
    const needsModified = !f.isDeleted
    const [original, read] = await Promise.all([
      needsOriginal ? window.electronAPI.git.showFile(worktreePath, path).catch(() => '') : Promise.resolve(''),
      needsModified ? readModified(path, filesRef.current.some(x => x.path === path && x.staged)) : Promise.resolve(noRead)
    ])
    if (diffFileRef.current !== path) return // another file was opened meanwhile
    setDiffOriginal(original)
    setDiffModified(read.text)
    setDiffError(read.error)
  }

  const loadStatusRef = useRef(loadStatus)
  loadStatusRef.current = loadStatus
  const reloadActiveDiffRef = useRef(reloadActiveDiff)
  reloadActiveDiffRef.current = reloadActiveDiff
  const onGitChangedRef = useRef(onGitChanged)
  onGitChangedRef.current = onGitChanged

  // Auto-refresh: edits made in the worktree (agent CLI, another editor, the
  // terminal) are reflected without clicking refresh or reselecting the worktree.
  useEffect(() => {
    window.electronAPI.fs.watch(worktreePath)
    let timer: number | undefined
    let gitTimer: number | undefined
    const normalize = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
    const target = normalize(worktreePath)
    const off = window.electronAPI.fs.onChanged(({ root }) => {
      if (normalize(root) !== target) return
      if (timer) clearTimeout(timer)
      timer = window.setTimeout(async () => {
        await loadStatusRef.current({ keepSelection: true })
        await reloadActiveDiffRef.current()
        // the list colors follow the dirty state, at a calmer pace than the file list
        if (gitTimer) clearTimeout(gitTimer)
        gitTimer = window.setTimeout(() => onGitChangedRef.current?.([worktreePath]), 1500)
      }, 250)
    })
    return () => {
      if (timer) clearTimeout(timer)
      if (gitTimer) clearTimeout(gitTimer)
      off()
      window.electronAPI.fs.unwatch(worktreePath)
    }
  }, [worktreePath])

  const handleStage = async (filePath: string) => {
    await window.electronAPI.git.stage(worktreePath, [filePath])
    loadStatus()
  }

  const handleUnstage = async (filePath: string) => {
    await window.electronAPI.git.unstage(worktreePath, [filePath])
    loadStatus()
  }

  const confirmDiscard = async () => {
    if (!discardTarget) return
    setIsDiscarding(true)
    try {
      await window.electronAPI.git.discardChanges(worktreePath, discardTarget.file, {
        staged: discardTarget.staged,
        untracked: discardTarget.untracked
      })
      showToast(discardTarget.untracked ? `file eliminato: ${discardTarget.file}` : `modifiche annullate: ${discardTarget.file}`)
      if (diffFileRef.current === discardTarget.file) {
        diffFileRef.current = null
        setDiffFile(null)
      }
      await loadStatus()
    } catch (e) {
      showToast((e as Error).message || 'annullamento fallito', 'error')
    } finally {
      setIsDiscarding(false)
      setDiscardTarget(null)
    }
  }

  const handleCopyPath = (filePath: string) => {
    window.electronAPI.clipboard.write(joinPath(worktreePath, filePath))
  }

  // open Explorer/Finder on the file's folder, with the file selected
  const handleReveal = (filePath: string) => {
    window.electronAPI.shell.showItemInFolder(joinPath(worktreePath, filePath))
  }

  const handleStageAll = async () => {
    await window.electronAPI.git.stageAll(worktreePath)
    loadStatus()
  }

  const runGit = async (id: string, fn: () => Promise<void>, okMsg: string) => {
    if (busy) return
    setBusy(id)
    try {
      await fn()
      showToast(okMsg)
      // pull moves the remote refs of every branch; the rest touch this worktree (and the transfer target)
      onGitChanged?.(id === 'pull' ? undefined : id === 'transfer' ? [worktreePath, moveTarget] : [worktreePath])
    } catch (e) {
      showToast((e as Error).message || 'operazione fallita', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleCommit = async () => {
    if (!commitMsg.trim()) return
    await runGit('commit', async () => {
      await window.electronAPI.git.commit(worktreePath, commitMsg.trim())
      if (commitAndPush) await window.electronAPI.git.push(worktreePath)
    }, commitAndPush ? 'committed & pushed' : 'committed')
    setIsCommitOpen(false)
    setCommitMsg('')
    setCommitAndPush(false)
    loadStatus()
  }

  const handlePull = () => runGit('pull', () => window.electronAPI.git.pull(worktreePath), 'pulled')
  const handlePush = () => runGit('push', () => window.electronAPI.git.push(worktreePath), 'pushed')

  const toggleTransfer = async () => {
    if (isMoveOpen) {
      setIsMoveOpen(false)
      return
    }
    setIsCommitOpen(false)
    try {
      const list = await window.electronAPI.worktree.list(repoPath || worktreePath)
      const targets = list.filter(e => e.path !== worktreePath)
      setMoveTargets(targets)
      setMoveTarget(prev => prev && targets.some(t => t.path === prev) ? prev : (targets[0]?.path ?? ''))
      setIsMoveOpen(true)
    } catch (e) {
      showToast((e as Error).message || 'failed to load worktrees', 'error')
    }
  }

  const handleTransfer = async () => {
    if (!moveTarget) return
    await runGit('transfer', async () => {
      const res = await window.electronAPI.git.transferChanges(worktreePath, moveTarget, { copy: !moveIsMove, stagedOnly: moveStagedOnly })
      if (!res.ok) throw new Error(res.message)
    }, moveIsMove ? 'changes moved' : 'changes copied')
    setIsMoveOpen(false)
    loadStatus()
  }

  const handleViewDiff = async (filePath: string) => {
    if (diffFileRef.current === filePath) return
    // remember where the file we're leaving was scrolled
    if (diffFileRef.current) {
      const lastLine = diffViewerRef.current?.getScrollLine()
      if (lastLine != null) scrollLinesRef.current[diffFileRef.current] = lastLine
    }
    diffFileRef.current = filePath
    setDiffFile(filePath)
    setSelectedIndex(visFiles.findIndex(f => f.path === filePath))
    setIsEditing(false)
    setIsLoadingDiff(true)
    setDiffOriginal('')
    setDiffModified('')
    setDiffError(null)
    // restore the file's own scroll (if already viewed), else jump to the line
    // the main editor is on when the same file is open there
    const nav = useEditorStore.getState().editorNav
    const full = `${worktreePath}/${filePath}`
    const stored = scrollLinesRef.current[filePath]
    const navLine =
      nav && nav.filePath.replace(/\\/g, '/').toLowerCase() === full.replace(/\\/g, '/').toLowerCase()
        ? nav.line
        : undefined
    setDiffInitialLine(stored ?? navLine)
    try {
      const file = files.find(f => f.path === filePath)

      // File nuovo → niente originale; file eliminato → niente modificato
      const needsOriginal = !file?.isNew
      const needsModified = !file?.isDeleted

      const [original, read] = await Promise.all([
        needsOriginal
          ? window.electronAPI.git.showFile(worktreePath, filePath).catch(() => '')
          : Promise.resolve(''),
        needsModified
          ? readModified(filePath, files.some(f => f.path === filePath && f.staged))
          : Promise.resolve(noRead)
      ])
      // arrow-key navigation fires reads back to back: a late answer for a file
      // the user already left must not overwrite the one now on screen
      if (diffFileRef.current !== filePath) return
      setDiffOriginal(original)
      setDiffModified(read.text)
      setDiffError(read.error)
    } finally {
      if (diffFileRef.current === filePath) setIsLoadingDiff(false)
    }
  }

  const openFile = async (absPath: string) => {
    if (diffFileRef.current) {
      const lastLine = diffViewerRef.current?.getScrollLine()
      if (lastLine != null) scrollLinesRef.current[diffFileRef.current] = lastLine
    }
    const normalized = absPath.replace(/\\/g, '/')
    const prefix = worktreePath.replace(/\\/g, '/') + '/'
    const rel = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized
    const known = files.find(f => f.path === rel)
    if (known) {
      handleViewDiff(known.path)
      return
    }
    diffFileRef.current = rel
    setDiffFile(rel)
    setSelectedIndex(-1)
    setIsEditing(true)
    setIsLoadingDiff(true)
    setDiffOriginal('')
    setDiffModified('')
    setDiffError(null)
    try {
      const content = await window.electronAPI.fs.readFile(`${worktreePath}/${rel}`).catch(() => '')
      setEditedContent(content)
      setDiffModified(content)
    } finally {
      setIsLoadingDiff(false)
    }
  }

  if (handleRef) handleRef.current = { openFile }

  const handleStartEdit = () => {
    // continue exactly where the diff is showing (the user's current line)
    pendingScrollLineRef.current = diffViewerRef.current?.getVisibleLine() ?? null
    setEditedContent(diffModified)
    setIsEditing(true)
  }

  // keep the diff position when coming back from edit (no stale initialLine jump)
  const syncDiffLineFromEdit = () => {
    const line = editEditorRef.current?.getPosition()?.lineNumber
    setDiffInitialLine(line ?? useEditorStore.getState().editorNav?.line ?? undefined)
  }

  const handleCancelEdit = () => {
    syncDiffLineFromEdit()
    setIsEditing(false)
    setEditorNav(null)
  }

  const handleSave = async () => {
    if (!diffFile) return
    setIsSaving(true)
    try {
      await window.electronAPI.fs.writeFile(`${worktreePath}/${diffFile}`, editedContent)
      syncDiffLineFromEdit()
      setIsEditing(false)
      setDiffModified(editedContent)
    } finally {
      setIsSaving(false)
    }
  }

  // Ctrl+S (or Cmd+S) in the edit editor does exactly what the save button does
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave

  useEffect(() => {
    if (!isEditing) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isEditing])

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

  // the first load and an unreadable status replace only the list: the caller's
  // layout (diff pane, file tree, terminal) stays mounted
  const statusPane = isLoading && files.length === 0 ? (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'
    }}>
      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
    </div>
  ) : error ? (
    <div style={{
      margin: '10px', padding: '14px', color: 'var(--error-color)',
      background: 'var(--error-bg)', border: '1px solid var(--error-color)',
      borderRadius: 'var(--radius-md)', display: 'flex',
      alignItems: 'flex-start', gap: '8px', fontSize: 'calc(11px * var(--ui-text-scale, 1))',
      fontFamily: 'var(--font-mono)'
    }}>
      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
      {error}
    </div>
  ) : null

  const renderZone = (label: string, list: GitFileStatus[], accent: string, total = list.length) => {
    if (list.length === 0) return null
    return (
      <div style={{ flexShrink: 0 }}>
        <div style={{
          padding: '4px 12px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, color: accent,
          textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-mono)',
          borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-subtle)'
        }}>
          {label} — {filterText ? `${list.length}/${total}` : list.length}
        </div>
        <FileDiffList
          files={list}
          onStage={handleStage}
          onUnstage={handleUnstage}
          onViewDiff={handleViewDiff}
           activeDiffFile={diffFile}
           checkMarks={checkMarks}
           onToggleCheck={onToggleCheck}
           onCopyPath={handleCopyPath}
           onReveal={handleReveal}
           onDiscard={(file, info) => setDiscardTarget({ file, ...info })}
         />
      </div>
    )
  }

  // header buttons: one git operation at a time; the counts are vs the last fetch
  const syncBtn = (id: 'pull' | 'push', label: string, icon: ReactNode, onClick: () => void, tipDesc: string, tag: ReactNode, accent = false) => (
    <button
      onClick={onClick}
      disabled={busy !== null}
      title={id}
      data-tip-desc={tipDesc}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0,
        height: 'calc(11px * var(--ui-text-scale, 1) + 12px)', padding: '0 10px',
        background: 'transparent', border: `1px solid ${accent ? 'var(--accent-color)' : 'var(--border-color)'}`,
        borderRadius: 'var(--radius-sm)', color: accent ? 'var(--accent-color)' : 'var(--text-secondary)',
        cursor: busy !== null ? 'not-allowed' : 'pointer', opacity: busy !== null ? 0.5 : 1,
        fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
      }}
      onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {busy === id ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : icon}
      {label}
      {tag}
    </button>
  )

  const behind = sync?.behind ?? 0
  const ahead = sync?.ahead ?? 0
  const syncButtons = (
    <>
      {syncBtn('pull', 'Pull', <Download size={11} />, handlePull,
        behind > 0 ? `${behind} commit da pullare (rispetto all'ultimo fetch)` : 'pull the latest changes from the remote into this worktree',
        behind > 0 && <span style={{ color: 'var(--warning-color)' }}>↓{behind}</span>)}
      {syncBtn('push', 'Push', <Upload size={11} />, handlePush,
        ahead > 0 ? `${ahead} commit da pushare (rispetto all'ultimo fetch)` : 'push the local commits of this worktree to the remote',
        ahead > 0 && <span>↑{ahead}</span>, true)}
    </>
  )

  const fileListPane = (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-card)', overflow: 'hidden'
    }}>
      {/* the count lives in the caller's tab label; pull/push in its header (syncButtons) */}
      <div style={{
        padding: '5px 10px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0
      }}>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            onClick={handleStageAll}
            title="stage all changes" data-tip-desc="stage every modified file at once"
            style={{
              display: 'flex', background: 'none', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer', padding: '2px'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--success-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <ListPlus size={11} />
          </button>
          <button
            onClick={() => setIsCommitOpen(o => !o)}
            title="commit" data-tip-desc="commit the staged changes of this worktree; tick commit &amp; push to also push"
            style={{
              display: 'flex', background: 'none', border: 'none',
              color: isCommitOpen ? 'var(--accent-color)' : 'var(--text-muted)',
              cursor: 'pointer', padding: '2px'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { if (!isCommitOpen) e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <GitCommitHorizontal size={11} />
          </button>
          <button
            onClick={toggleTransfer}
            title="transfer changes" data-tip-desc="move or copy the pending changes to another worktree via a shared stash (optionally only the staged ones)"
            style={{
              display: 'flex', background: 'none', border: 'none',
              color: isMoveOpen ? 'var(--accent-color)' : 'var(--text-muted)',
              cursor: 'pointer', padding: '2px'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { if (!isMoveOpen) e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <ArrowRightLeft size={11} />
          </button>
          <button
            onClick={() => loadStatus()}
            title="refresh" data-tip-desc="reload the current data from the repository"
            style={{
              display: 'flex', background: 'none', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer', padding: '2px'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <RefreshCw size={10} />
          </button>
        </div>
      </div>
      {isCommitOpen && (
        <div style={{
          padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0
        }}>
          <input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCommit() }}
            placeholder="commit message"
            spellCheck={false}
            autoFocus
            style={{
              width: '100%', padding: '3px 6px', boxSizing: 'border-box',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
              background: 'var(--bg-input)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none'
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
              fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)', flexShrink: 0
            }}>
              <input type="checkbox" checked={commitAndPush} onChange={(e) => setCommitAndPush(e.target.checked)} />
              commit &amp; push
            </label>
            <button
              onClick={handleCommit}
              disabled={!commitMsg.trim() || busy === 'commit'}
              title="commit" data-tip-desc={commitAndPush ? 'commit and push the staged changes' : 'commit the staged changes'}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 10px', height: '20px',
                background: commitMsg.trim() && busy !== 'commit' ? 'var(--accent-color)' : 'var(--bg-disabled)',
                border: 'none', borderRadius: 'var(--radius-sm)',
                color: commitMsg.trim() && busy !== 'commit' ? 'var(--text-inverse)' : 'var(--text-muted)',
                cursor: commitMsg.trim() && busy !== 'commit' ? 'pointer' : 'not-allowed',
                fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
              }}
            >
              {busy === 'commit' ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={10} />}
              {commitAndPush ? 'commit & push' : 'commit'}
            </button>
            <button
              onClick={() => { setIsCommitOpen(false); setCommitMsg(''); setCommitAndPush(false) }}
              title="cancel" data-tip-desc="close the commit form"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '22px', height: '20px', background: 'transparent',
                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}
      {isMoveOpen && (
        <div style={{
          padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0
        }}>
          <select
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
            title="target worktree" data-tip-desc="the worktree that receives the changes"
            style={{
              width: '100%', padding: '3px 6px', boxSizing: 'border-box',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
              background: 'var(--bg-input)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none'
            }}
          >
            {moveTargets.length === 0 && <option value="">no other worktrees</option>}
            {moveTargets.map(w => (
              <option key={w.path} value={w.path}>
                {w.branch || w.head.slice(0, 7)} — {w.path}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
              fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)', flexShrink: 0
            }}>
              <input type="checkbox" checked={moveIsMove} onChange={(e) => setMoveIsMove(e.target.checked)} />
              move (remove from this worktree)
            </label>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
              fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)', flexShrink: 0
            }}>
              <input type="checkbox" checked={moveStagedOnly} onChange={(e) => setMoveStagedOnly(e.target.checked)} />
              only staged (keep unstaged here)
            </label>
            <button
              onClick={handleTransfer}
              disabled={!moveTarget || busy === 'transfer'}
              title="transfer" data-tip-desc={moveIsMove ? 'move the changes to the selected worktree' : 'copy the changes to the selected worktree'}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 10px', height: '20px',
                background: moveTarget && busy !== 'transfer' ? 'var(--accent-color)' : 'var(--bg-disabled)',
                border: 'none', borderRadius: 'var(--radius-sm)',
                color: moveTarget && busy !== 'transfer' ? 'var(--text-inverse)' : 'var(--text-muted)',
                cursor: moveTarget && busy !== 'transfer' ? 'pointer' : 'not-allowed',
                fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
              }}
            >
              {busy === 'transfer' ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRightLeft size={10} />}
              {moveIsMove ? 'move' : 'copy'}
            </button>
            <button
              onClick={() => { setIsMoveOpen(false); setMoveTarget('') }}
              title="cancel" data-tip-desc="close the transfer form"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '22px', height: '20px', background: 'transparent',
                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}
      {(files.length > 0 || filterText) && (
        <FileFilterBar
          value={filterText} onChange={setFilterText}
          mode={filterMode} onModeChange={setFilterMode}
          caseSensitive={filterCase} onCaseToggle={() => setFilterCase(c => !c)}
          spaceSensitive={filterSpace} onSpaceToggle={() => setFilterSpace(s => !s)}
          placeholder="filter changes (regex)..."
        />
      )}
      <div
        style={{ flex: 1, overflow: 'auto', minHeight: 0, outline: 'none' }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (visFiles.length === 0 || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          // step through the visible (filtered) rows from the open file;
          // selectedIndex tells apart a path listed both staged and unstaged
          const cur = visFiles[selectedIndex]?.path === diffFileRef.current
            ? selectedIndex
            : visFiles.findIndex(f => f.path === diffFileRef.current)
          const next = e.key === 'ArrowDown' ? Math.min(cur + 1, visFiles.length - 1) : Math.max(cur - 1, 0)
          setSelectedIndex(next)
          handleViewDiff(visFiles[next].path)
        }}
      >
        {unmergedFiles.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <div style={{
              padding: '4px 12px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700,
              color: 'var(--error-color)', textTransform: 'uppercase', letterSpacing: '0.5px',
              fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--error-bg)', display: 'flex', alignItems: 'center', gap: '5px'
            }}>
              <GitMerge size={10} />
              conflicts — {unmergedFiles.length}
            </div>
            {unmergedFiles.map((f) => (
              <div key={`conflict:${f.path}`} onClick={() => setMergeTarget(f.path)}
                title={`resolve conflicts in ${f.path}`} data-tip-desc="open the merge tool for this file"
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px',
                  borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
                  background: 'var(--bg-card)', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
                  fontFamily: 'var(--font-mono)', color: 'var(--error-color)'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--error-bg)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)' }}>
                <GitMerge size={11} style={{ flexShrink: 0 }} />
                <span style={{
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: 'var(--text-primary)'
                }}>
                  {f.path}
                </span>
                <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, flexShrink: 0 }}>
                  resolve
                </span>
              </div>
            ))}
          </div>
        )}
        {renderZone('staged changes', visStaged, 'var(--success-color)', stagedFiles.length)}
        {renderZone('changes', visUnstaged, 'var(--warning-color)', unstagedFiles.length)}
        {files.length === 0 && unmergedFiles.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            no changes
          </div>
        )}
        {files.length > 0 && visFiles.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            no matching files
          </div>
        )}
      </div>
    </div>
  )

  const diffPane = (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-card)', overflow: 'hidden'
    }}>
      {diffFile ? (
        isLoadingDiff ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'
          }}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
          </div>
        ) : isEditing ? (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 8px', borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-primary)', flexShrink: 0, gap: '8px'
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                overflow: 'hidden', flex: 1
              }}>
                <span style={{
                  padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--warning-bg)', color: 'var(--warning-color)',
                  fontWeight: 700, fontSize: 'calc(9px * var(--ui-text-scale, 1))', flexShrink: 0
                }}>
                  editing
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{diffFile}</span>
              </div>
              <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                {diffFile?.toLowerCase().endsWith('.md') && (
                  <button onClick={() => setMdPreview(p => !p)}
                    title={mdPreview ? 'show source' : 'preview rendered markdown'} data-tip-desc={mdPreview ? 'show the markdown source code' : 'render the markdown preview'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '3px', padding: '0 8px', height: '20px',
                      background: mdPreview ? 'var(--accent-bg)' : 'transparent',
                      border: `1px solid ${mdPreview ? 'var(--accent-color)' : 'var(--border-color)'}`,
                      borderRadius: 'var(--radius-sm)',
                      color: mdPreview ? 'var(--accent-color)' : 'var(--text-muted)',
                      cursor: 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))',
                      fontFamily: 'var(--font-mono)', fontWeight: 600
                    }}>
                    <Eye size={10} />
                    {mdPreview ? 'source' : 'preview'}
                  </button>
                )}
                <button onClick={handleCancelEdit} title="cancel" data-tip-desc="cancel and close"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '20px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}>
                  <X size={11} />
                </button>
                <button onClick={handleSave} disabled={isSaving} title="save" data-tip-desc="save the changes"
                  style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '0 8px', height: '20px', background: 'var(--accent-color)', border: 'none', borderRadius: 'var(--radius-sm)', color: 'var(--text-inverse)', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                  onMouseEnter={(e) => { if (!isSaving) e.currentTarget.style.opacity = '0.9' }}
                  onMouseLeave={(e) => { if (!isSaving) e.currentTarget.style.opacity = '1' }}>
                  {isSaving ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={10} />}
                  {isSaving ? 'saving' : 'save'}
                </button>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {diffFile?.toLowerCase().endsWith('.md') && mdPreview ? (
                <MarkdownView content={editedContent} />
              ) : (
              <Editor
                height="100%"
                language={detectLang(diffFile)}
                theme={useUIStore.getState().theme === 'dark' ? THEME_DARK : THEME_LIGHT}
                value={editedContent}
                onChange={(v) => setEditedContent(v || '')}
                onMount={(editor, monaco) => {
                  applyEditorTheme(monaco)
                  editEditorRef.current = editor
                  const editPath = diffFile ? `${worktreePath}/${diffFile}` : null
                  registerCSharpHover(monaco)
                  trackHoverModel(editor.getModel(), editPath)
                  const model = editor.getModel()
                  if (model) {
                    model.onDidChangeContent(() => {
                      scheduleCSharpDiagnostics(editor, monaco, editPath, 700)
                    })
                  }
                  applyCSharpDiagnostics(editor, monaco, editPath)
                  editor.onDidScrollChange(() => {
                    const line = editor.getVisibleRanges()?.[0]?.startLineNumber ?? null
                    updateEditorNav(line)
                  })
                  editor.onDidChangeCursorPosition(() => {
                    const line = editor.getPosition()?.lineNumber
                    if (line) updateEditorNav(line)
                  })
                  if (pendingScrollLineRef.current) {
                    const line = pendingScrollLineRef.current
                    pendingScrollLineRef.current = null
                    // wait until the viewport is real (≥4 visible lines) AND the model
                    // has enough lines: at mount the container can be collapsed to ~1
                    // line, so revealLineInCenter would not scroll at all
                    let tries = 0
                    const attempt = () => {
                      try {
                        const vr = editor.getVisibleRanges()?.[0]
                        const viewReady = !!vr && (vr.endLineNumber - vr.startLineNumber) >= 4
                        const modelReady = (editor.getModel()?.getLineCount() ?? 0) >= line
                        if ((viewReady && modelReady) || tries > 30) {
                          editor.revealLineInCenter(line)
                          editor.setPosition({ lineNumber: line, column: 1 })
                          updateEditorNav(line)
                        } else {
                          tries++
                          setTimeout(attempt, 60)
                        }
                      } catch { /* ignore */ }
                    }
                    attempt()
                  }
                }}
                options={{
                  fontSize: appFontSize,
                  fontFamily: appFontStack(appFont),
                  fontLigatures: false,
                  minimap: { enabled: true, maxColumn: 80, renderCharacters: false },
                  mouseWheelZoom: true,
                  lineNumbers: 'on',
                  renderWhitespace: 'selection',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  padding: { top: 10 },
                  tabSize: 2,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  smoothScrolling: true,
                  bracketPairColorization: { enabled: true },
                  guides: { indentation: true, bracketPairs: true },
                  folding: true,
                  foldingHighlight: true,
                  showFoldingControls: 'mouseover',
                  glyphMargin: true,
                  lineDecorationsWidth: 10,
                  renderLineHighlight: 'all',
                  occurrencesHighlight: 'singleFile',
                  selectionHighlight: true,
                  suggestOnTriggerCharacters: true,
                  wordBasedSuggestions: 'currentDocument',
                  hover: { enabled: 'on', delay: 500 },
                  stickyScroll: { enabled: true, maxLineCount: 5 },
                  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
                }}
              />
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-primary)', flexShrink: 0, gap: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, overflow: 'hidden' }}>
                <span style={{ padding: '1px 5px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-tag)', color: 'var(--accent-color)', fontWeight: 700, fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                  diff
                </span>
                <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{diffFile}</span>
              </div>
              <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                {/* no edit on an unreadable file: saving would write an empty one */}
                {!diffError && (
                <button onClick={handleStartEdit} title="edit file" data-tip-desc="open the file in edit mode"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '20px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)'; e.currentTarget.style.borderColor = 'var(--accent-color)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}>
                  <Pencil size={11} />
                </button>
                )}
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {diffError ? (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', height: '100%',
                  padding: '16px', boxSizing: 'border-box', textAlign: 'center', wordBreak: 'break-word',
                  color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
                }}>
                  <AlertCircle size={12} style={{ flexShrink: 0 }} />
                  {diffError}
                </div>
              ) : (
              <DiffViewer
                ref={diffViewerRef}
                original={diffOriginal}
                modified={diffModified}
                filePath={diffFile}
                onClose={() => { diffFileRef.current = null; setDiffFile(null) }}
                onPopOut={() => setIsDiffFullscreen(true)}
                onVisibleLineChange={(line) => {
                  if (diffFile) scrollLinesRef.current[diffFile] = line
                  updateEditorNav(line)
                }}
                initialLine={diffInitialLine}
              />
              )}
            </div>
          </>
        )
      ) : (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', gap: '12px',
          color: 'var(--text-muted)', fontFamily: 'var(--font-mono)'
        }}>
          <GitCompare size={28} strokeWidth={1} />
          <div style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', textAlign: 'center', lineHeight: 1.7 }}>
            click a file to see its changes<br />
            <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>
              green = added · red = removed · markers in the scroll zone
            </span>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
      {layout({ list: statusPane ?? fileListPane, diff: diffPane, count: files.length, conflicts: unmergedFiles.length, statusError: error, syncButtons })}

      {isDiffFullscreen && diffFile && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'var(--bg-primary)',
          display: 'flex', flexDirection: 'column'
        }}>
          {isLoadingDiff ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%'
            }}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
            </div>
          ) : (
            <DiffViewer
              original={diffOriginal}
              modified={diffModified}
              filePath={diffFile}
              onClose={() => setIsDiffFullscreen(false)}
              onVisibleLineChange={(line) => {
                if (diffFile) scrollLinesRef.current[diffFile] = line
                updateEditorNav(line)
              }}
              initialLine={diffInitialLine}
            />
          )}
        </div>
      )}

      {mergeTarget && (
        <MergeTool
          repoPath={worktreePath}
          filePath={mergeTarget}
          onClose={() => setMergeTarget(null)}
          onResolved={loadStatus}
        />
      )}

      {discardTarget && (
        <Modal onClose={() => { if (!isDiscarding) setDiscardTarget(null) }} width={440} label="discard changes">
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} style={{ color: 'var(--error-color)', flexShrink: 0 }} />
              <span style={{ fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
                {discardTarget.untracked ? 'Elimina file' : 'Annulla modifiche'}
              </span>
            </div>
            <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {discardTarget.untracked
                ? 'Il file non è tracciato da git: verrà eliminato dal disco. Operazione non reversibile.'
                : 'Le modifiche non salvate di questo file verranno ripristinate all\'ultima versione committata. Operazione non reversibile.'}
              <div style={{ marginTop: '6px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                {discardTarget.file}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setDiscardTarget(null)} disabled={isDiscarding}
                style={{
                  display: 'flex', alignItems: 'center', padding: '5px 12px', height: '26px',
                  background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)', cursor: isDiscarding ? 'not-allowed' : 'pointer',
                  fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                }}>
                annulla
              </button>
              <button onClick={confirmDiscard} disabled={isDiscarding}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', height: '26px',
                  background: 'var(--error-color)', border: 'none', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-inverse)', cursor: isDiscarding ? 'not-allowed' : 'pointer',
                  fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                }}>
                {isDiscarding ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Undo2 size={11} />}
                {isDiscarding ? 'annullamento…' : (discardTarget.untracked ? 'elimina' : 'annulla modifiche')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
