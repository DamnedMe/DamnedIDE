import { useEffect, useState, useCallback, useRef } from 'react'
import { GitFileStatus } from '../../types/git'
import { FileDiffList } from '../git/FileDiffList'
import { DiffViewer } from '../editor/DiffViewer'
import type { DiffViewerHandle } from '../editor/DiffViewer'
import { useEditorStore } from '../../store'
import { ResizableSplitter } from '../layout/ResizableSplitter'
import { Loader2, AlertCircle, GitCompare, RefreshCw, Pencil, Save, X, ListPlus, GitMerge, Eye, GitCommitHorizontal, Download, Upload, Check, ArrowRightLeft } from 'lucide-react'
import { MergeTool } from './MergeTool'
import { MarkdownView } from '../editor/MarkdownView'
import Editor from '@monaco-editor/react'
import { defineThemes, THEME_DARK, THEME_LIGHT, patchCSharpGrammar } from '../editor/monaco-theme'
import { useUIStore, useSettingsStore, useToastStore } from '../../store'
import { applyCSharpDiagnostics, clearCSharpDiagnostics, scheduleCSharpDiagnostics } from '../../utils/csharp-diagnostics'
import { registerCSharpHover, trackHoverModel } from '../../utils/csharp-hover'

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
}

export interface WorktreeChangesHandle {
  openFile: (absPath: string) => void
}

export function WorktreeChanges({ worktreePath, repoPath, checkMarks, onToggleCheck, onFileSelected, handleRef }: WorktreeChangesProps) {
  const [files, setFiles] = useState<GitFileStatus[]>([])
  const [stagedFiles, setStagedFiles] = useState<GitFileStatus[]>([])
  const [unstagedFiles, setUnstagedFiles] = useState<GitFileStatus[]>([])
  const [unmergedFiles, setUnmergedFiles] = useState<GitFileStatus[]>([])
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffFile, setDiffFile] = useState<string | null>(null)
  const diffFileRef = useRef<string | null>(null)
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
  const [isCommitOpen, setIsCommitOpen] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [commitAndPush, setCommitAndPush] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [isMoveOpen, setIsMoveOpen] = useState(false)
  const [moveTargets, setMoveTargets] = useState<{ path: string; branch: string; head: string }[]>([])
  const [moveTarget, setMoveTarget] = useState('')
  const [moveIsMove, setMoveIsMove] = useState(true)
  const [moveStagedOnly, setMoveStagedOnly] = useState(false)

  const updateEditorNav = (line: number | null) => {
    if (!diffFile || line == null) return
    setEditorNav({ rootPath: worktreePath, filePath: `${worktreePath}/${diffFile}`, line })
  }

  useEffect(() => {
    if (!diffFile) return
    onFileSelected?.(`${worktreePath}\\${diffFile}`)
  }, [diffFile])

  const loadStatus = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setDiffFile(null)
    diffFileRef.current = null
    setSelectedIndex(0)
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
      setStagedFiles(staged)
      setUnstagedFiles(unstaged)
      setUnmergedFiles(unmerged)
      setFiles([...staged, ...unstaged].sort((a, b) => a.path.localeCompare(b.path)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [worktreePath])

  useEffect(() => {
    loadStatus()
    setDiffFile(null)
  }, [loadStatus])

  const handleStage = async (filePath: string) => {
    await window.electronAPI.git.stage(worktreePath, [filePath])
    loadStatus()
  }

  const handleUnstage = async (filePath: string) => {
    await window.electronAPI.git.unstage(worktreePath, [filePath])
    loadStatus()
  }

  const handleCopyPath = (filePath: string) => {
    const root = worktreePath.replace(/[\\/]+$/, '')
    window.electronAPI.clipboard.write(`${root}\\${filePath.replace(/\//g, '\\')}`)
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

  const handleFetch = () => runGit('fetch', () => window.electronAPI.git.fetch(worktreePath), 'fetched')
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
    setSelectedIndex(files.findIndex(f => f.path === filePath))
    setIsEditing(false)
    setIsLoadingDiff(true)
    setDiffOriginal('')
    setDiffModified('')
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
      const fsPath = `${worktreePath}/${filePath}`

      // File nuovo → niente originale; file eliminato → niente modificato
      const needsOriginal = !file?.isNew
      const needsModified = !file?.isDeleted

      const [original, modified] = await Promise.all([
        needsOriginal
          ? window.electronAPI.git.showFile(worktreePath, filePath).catch(() => '')
          : Promise.resolve(''),
        needsModified
          ? window.electronAPI.fs.readFile(fsPath).catch(() => '')
          : Promise.resolve('')
      ])
      setDiffOriginal(original)
      setDiffModified(modified)
    } finally {
      setIsLoadingDiff(false)
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

  if (isLoading && files.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', background: 'var(--bg-card)',
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)'
      }}>
        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        padding: '14px', color: 'var(--error-color)',
        background: 'var(--error-bg)', border: '1px solid var(--error-color)',
        borderRadius: 'var(--radius-md)', display: 'flex',
        alignItems: 'flex-start', gap: '8px', fontSize: 'calc(11px * var(--ui-text-scale, 1))',
        fontFamily: 'var(--font-mono)'
      }}>
        <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
        {error}
      </div>
    )
  }

  const renderZone = (label: string, list: GitFileStatus[], accent: string) => {
    if (list.length === 0) return null
    return (
      <div style={{ flexShrink: 0 }}>
        <div style={{
          padding: '4px 12px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, color: accent,
          textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-mono)',
          borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-subtle)'
        }}>
          {label} — {list.length}
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
         />
      </div>
    )
  }

  const gitBtn = (id: string, title: string, icon: React.ReactNode, onClick: () => void, tipDesc?: string) => (
    <button
      onClick={onClick}
      disabled={busy !== null}
      title={title}
      data-tip-desc={tipDesc}
      style={{
        display: 'flex', background: 'none', border: 'none',
        color: 'var(--text-muted)', cursor: busy !== null ? 'not-allowed' : 'pointer',
        padding: '2px', opacity: busy !== null ? 0.4 : 1
      }}
      onMouseEnter={(e) => { if (!busy) e.currentTarget.style.color = 'var(--accent-color)' }}
      onMouseLeave={(e) => { if (!busy) e.currentTarget.style.color = 'var(--text-muted)' }}
    >
      {busy === id ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : icon}
    </button>
  )

  const fileListPane = (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-card)', overflow: 'hidden'
    }}>
      <div style={{
        padding: '7px 12px', borderBottom: '1px solid var(--border-subtle)',
        fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-secondary)',
        display: 'flex', alignItems: 'center', gap: '6px',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        fontFamily: 'var(--font-mono)', flexShrink: 0
      }}>
        <span style={{
          width: '5px', height: '5px', borderRadius: '50%',
          background: files.length > 0 ? 'var(--warning-color)' : 'var(--success-color)',
          display: 'inline-block'
        }} />
        changes — {files.length}
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
          <span style={{ width: '1px', height: '10px', background: 'var(--border-subtle)', flexShrink: 0 }} />
          {gitBtn('fetch', 'fetch', <RefreshCw size={10} />, handleFetch, 'fetch the latest changes from the remote into this worktree')}
          {gitBtn('pull', 'pull', <Download size={10} />, handlePull, 'pull the latest changes from the remote into this worktree')}
          {gitBtn('push', 'push', <Upload size={10} />, handlePush, 'push the local commits of this worktree to the remote')}
          <button
            onClick={loadStatus}
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
      <div
        style={{ flex: 1, overflow: 'auto', minHeight: 0, outline: 'none' }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (files.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            const next = Math.min(selectedIndex + 1, files.length - 1)
            setSelectedIndex(next)
            handleViewDiff(files[next].path)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            const prev = Math.max(selectedIndex - 1, 0)
            setSelectedIndex(prev)
            handleViewDiff(files[prev].path)
          }
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
        {renderZone('staged changes', stagedFiles, 'var(--success-color)')}
        {renderZone('changes', unstagedFiles, 'var(--warning-color)')}
        {files.length === 0 && unmergedFiles.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            no changes
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
                  fontSize: 12.5,
                  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
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
                <button onClick={handleStartEdit} title="edit file" data-tip-desc="open the file in edit mode"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '20px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)'; e.currentTarget.style.borderColor = 'var(--accent-color)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}>
                  <Pencil size={11} />
                </button>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <DiffViewer
                ref={diffViewerRef}
                original={diffOriginal}
                modified={diffModified}
                filePath={diffFile}
                onClose={() => setDiffFile(null)}
                onPopOut={() => setIsDiffFullscreen(true)}
                onVisibleLineChange={(line) => {
                  if (diffFile) scrollLinesRef.current[diffFile] = line
                  updateEditorNav(line)
                }}
                initialLine={diffInitialLine}
              />
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
      <div style={{
        height: '100%',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden'
      }}>
        <ResizableSplitter direction="vertical" defaultSize={200} minSize={80}>
          {fileListPane}
          {diffPane}
        </ResizableSplitter>
      </div>

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
    </>
  )
}
