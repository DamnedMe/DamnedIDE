import { useEffect, useState, useCallback, useRef } from 'react'
import { PanelContainer } from '../layout/PanelContainer'
import { ResizableSplitter } from '../layout/ResizableSplitter'
import { WorktreeList } from './WorktreeList'
import { WorktreeChanges, type WorktreeChangesHandle } from './WorktreeChanges'
import { CompleteWorktreeDialog } from './CompleteWorktreeDialog'
import { NewWorktreeDialog } from './NewWorktreeDialog'
import { FileTree } from '../editor/FileTree'
import { FileFilterBar } from '../editor/CodeEditor'
import { useWorktreeStore } from '../../store'
import { FolderOpen, Plus, RefreshCw, PanelLeftClose, PanelLeftOpen, FolderTree, ChevronUp, ChevronDown, GitPullRequest, EyeOff, Eye, Trash2 } from 'lucide-react'
import { WorktreeEntry } from '../../types/worktree'

type CheckState = 'ok' | 'ko'
type CheckMarks = Record<string, Record<string, CheckState>>

interface WorktreePanelProps {
  repoPath: string | null
  onRepoSelected: (path: string) => void
}

function shortBranch(branch: string): string {
  if (!branch) return ''
  if (branch === 'main' || branch === 'master' || branch === 'develop') return branch
  const parts = branch.split('/')
  return parts[parts.length - 1] || branch
}

export function WorktreePanel({ repoPath, onRepoSelected }: WorktreePanelProps) {
  const { entries, setEntries, selectedWorktree, isLoading, setLoading, selectWorktree } = useWorktreeStore()
  const [listCollapsed, setListCollapsed] = useState(false)
  const [checkMarks, setCheckMarks] = useState<CheckMarks>({})
  const [explorerSelectedFile, setExplorerSelectedFile] = useState<string | null>(null)
  const [worktreesCollapsed, setWorktreesCollapsed] = useState(false)
  const [filesCollapsed, setFilesCollapsed] = useState(false)
  const [fileFilter, setFileFilter] = useState('')
  const [filterMode, setFilterMode] = useState<'startsWith' | 'like' | 'regex'>('like')
  const [filterCaseSensitive, setFilterCaseSensitive] = useState(false)
  const [filterSpaceSensitive, setFilterSpaceSensitive] = useState(false)
  const [stripMenu, setStripMenu] = useState<{ x: number; y: number; entry: WorktreeEntry } | null>(null)
  const [completeTarget, setCompleteTarget] = useState<WorktreeEntry | null>(null)
  const [showNewWorktree, setShowNewWorktree] = useState(false)
  const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(new Set())
  const changesHandleRef = useRef<WorktreeChangesHandle | null>(null)

  const filter = fileFilter
    ? { query: fileFilter, mode: filterMode, caseSensitive: filterCaseSensitive, spaceSensitive: filterSpaceSensitive }
    : null

  const refreshWorktrees = async () => {
    if (!repoPath) return
    const list = await window.electronAPI.worktree.list(repoPath)
    setEntries(list)
    const selected = useWorktreeStore.getState().selectedWorktree
    if (selected && !list.some(e => e.path === selected)) {
      // selection vanished (e.g. worktree removed): fall back to the repository
      // with the same name as the open folder (the main repo entry)
      const main = list.find(e => !e.path.includes('.worktrees'))
      selectWorktree(main ? main.path : null)
    }
  }

  const loadWorktrees = async () => {
    if (!repoPath) return
    setLoading(true)
    try {
      await window.electronAPI.worktree.prune(repoPath).catch(() => {})
      await refreshWorktrees()
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveWorktree = async (path: string) => {
    if (!repoPath) return
    try {
      await window.electronAPI.worktree.remove(repoPath, path)
    } catch {
      // fallback: delete the folder directly
      try { await window.electronAPI.fs.removeDir(path) } catch { /* ignore */ }
    }
    loadWorktrees()
  }

  const handleHide = (path: string) => {
    setHiddenPaths(prev => new Set([...prev, path]))
    setStripMenu(null)
  }

  const handleUnhide = (path: string) => {
    setHiddenPaths(prev => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
    setStripMenu(null)
  }

  const handleComplete = (entry: WorktreeEntry) => {
    setStripMenu(null)
    setCompleteTarget(entry)
  }

  const handleToggleCheck = useCallback((worktreePath: string, filePath: string, state: CheckState | null) => {
    setCheckMarks(prev => {
      const wt = { ...(prev[worktreePath] || {}) }
      if (state === null) {
        delete wt[filePath]
      } else {
        wt[filePath] = state
      }
      return { ...prev, [worktreePath]: wt }
    })
  }, [])

  useEffect(() => {
    if (repoPath) loadWorktrees()
  }, [repoPath])

  const stripBtn = (onClick: () => void, title: string, children: React.ReactNode) => (
    <button onClick={onClick} title={title}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0, borderRadius: 'var(--radius-sm)' }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none' }}>
      {children}
    </button>
  )

  const ToolStrip = (
    <div style={{
      width: '44px', flexShrink: 0, background: 'var(--bg-card)',
      border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '6px 2px', gap: '4px', overflow: 'hidden'
    }}>
      {/* top buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)', paddingBottom: '4px', marginBottom: '2px', width: '100%' }}>
        {stripBtn(() => setListCollapsed(!listCollapsed), listCollapsed ? 'show panel' : 'collapse panel', listCollapsed ? <PanelLeftOpen size={12} /> : <PanelLeftClose size={12} />)}
        {stripBtn(loadWorktrees, 'refresh', <RefreshCw size={11} />)}
      </div>
      {/* worktree tabs */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', overflow: 'auto', padding: '0 2px', width: '100%' }}>
        {entries.filter(e => !hiddenPaths.has(e.path)).map((entry) => {
          const isMain = !entry.path.includes('.worktrees')
          const isSelected = selectedWorktree === entry.path
          const label = shortBranch(entry.branch)
          return (
            <div key={entry.path}
              onClick={() => selectWorktree(isSelected ? null : entry.path)}
              onContextMenu={(e) => { e.preventDefault(); setStripMenu({ x: e.clientX, y: e.clientY, entry }) }}
              title={entry.branch || entry.head.substring(0, 7)}
              style={{
                width: '30px', height: '22px', borderRadius: '4px', flexShrink: 0,
                background: isSelected ? 'var(--bg-active)' : 'transparent',
                border: isSelected ? '1.5px solid var(--accent-color)' : '1.5px solid var(--border-color)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', fontSize: '8px', fontWeight: 700,
                fontFamily: 'var(--font-mono)', color: isSelected ? 'var(--accent-color)' : 'var(--text-muted)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                if (!isSelected) { e.currentTarget.style.borderColor = 'var(--text-secondary)'; e.currentTarget.style.color = 'var(--text-secondary)' }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)' }
              }}>
              {isMain ? 'main' : label.substring(0, 4)}
            </div>
          )
        })}
        {stripBtn(() => setShowNewWorktree(true), 'new worktree', <Plus size={13} />)}
      </div>
      {/* bottom: change main folder */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border-subtle)', paddingTop: '4px', width: '100%', display: 'flex', justifyContent: 'center' }}>
        {stripBtn(async () => {
          const p = await window.electronAPI.dialog.openFolder()
          if (p) onRepoSelected(p)
        }, 'change main folder', <FolderOpen size={13} />)}
      </div>
    </div>
  )

  if (!repoPath) {
    return (
      <PanelContainer title="Worktree">
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', gap: '20px', color: 'var(--text-muted)'
        }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FolderOpen size={28} strokeWidth={1} />
          </div>
          <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
            <p style={{ margin: '0 0 4px', fontSize: '13px', color: 'var(--text-secondary)' }}>open a git repository</p>
            <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)' }}>to manage worktrees</p>
          </div>
          <button onClick={async () => { const p = await window.electronAPI.dialog.openFolder(); if (p) onRepoSelected(p) }}
            style={{ padding: '8px 20px', background: 'var(--accent-color)', color: 'var(--text-inverse)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
            open repo
          </button>
        </div>
      </PanelContainer>
    )
  }

  return (
    <PanelContainer title="Worktree">
      <div style={{ height: '100%', display: 'flex', gap: '4px', overflow: 'hidden' }}>
        {ToolStrip}
        {selectedWorktree ? (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', overflow: 'hidden' }}>
          <ResizableSplitter direction="horizontal" defaultSize={330} minSize={180} maxSize={600} collapsed={listCollapsed}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '4px' }}>
                  {/* ─── Worktrees section ─── */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '4px 8px', flexShrink: 0, background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                    fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.5px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FolderTree size={12} />
                      worktrees
                    </div>
                    <button
                      onClick={() => setWorktreesCollapsed(!worktreesCollapsed)}
                      title={worktreesCollapsed ? 'expand' : 'collapse'}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                      {worktreesCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                    </button>
                  </div>
                  {!worktreesCollapsed && (
                    <div style={{
                      flex: worktreesCollapsed ? 0 : 1, minHeight: 0,
                      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)', overflow: 'hidden'
                    }}>
                      <WorktreeList repoPath={repoPath} entries={entries} isLoading={isLoading} onRemove={handleRemoveWorktree} onComplete={handleComplete} />
                    </div>
                  )}
                  {/* ─── Files section ─── */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '4px 8px', flexShrink: 0, background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                    fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.5px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FolderOpen size={12} />
                      files
                    </div>
                    <button
                      onClick={() => setFilesCollapsed(!filesCollapsed)}
                      title={filesCollapsed ? 'expand' : 'collapse'}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                      {filesCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                    </button>
                  </div>
                  {!filesCollapsed && (
                    <div style={{
                      flex: 1, minHeight: 0,
                      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column'
                    }}>
                      <FileFilterBar value={fileFilter} onChange={setFileFilter} mode={filterMode} onModeChange={setFilterMode} caseSensitive={filterCaseSensitive} onCaseToggle={() => setFilterCaseSensitive(!filterCaseSensitive)} spaceSensitive={filterSpaceSensitive} onSpaceToggle={() => setFilterSpaceSensitive(!filterSpaceSensitive)} />
                      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <FileTree rootPath={selectedWorktree} onFileSelect={(f) => changesHandleRef.current?.openFile(f)} selectedFile={explorerSelectedFile} filter={filter} />
                      </div>
                    </div>
                  )}
                </div>
                <WorktreeChanges worktreePath={selectedWorktree} checkMarks={checkMarks[selectedWorktree] || {}} onToggleCheck={(file, state) => handleToggleCheck(selectedWorktree, file, state)} onFileSelected={setExplorerSelectedFile} handleRef={changesHandleRef} />
              </ResizableSplitter>
          </div>
          ) : (
          <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <WorktreeList repoPath={repoPath} entries={entries} isLoading={isLoading} onRemove={handleRemoveWorktree} onComplete={handleComplete} />
          </div>
        )}
      </div>

      {stripMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setStripMenu(null)} />
          <div style={{
            position: 'fixed', left: stripMenu.x, top: stripMenu.y, zIndex: 200,
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', padding: '4px 0', minWidth: '180px',
            boxShadow: 'var(--shadow-lg)', animation: 'fadeIn 0.1s ease'
          }}>
            {hiddenPaths.has(stripMenu.entry.path) ? (
              <StripMenuItem icon={<Eye size={12} />} label="unhide" onClick={() => handleUnhide(stripMenu.entry.path)} />
            ) : (
              <StripMenuItem icon={<EyeOff size={12} />} label="hide from list" onClick={() => handleHide(stripMenu.entry.path)} />
            )}
            <StripMenuItem icon={<GitPullRequest size={12} />} label="completa worktree" onClick={() => handleComplete(stripMenu.entry)} />
            {!stripMenu.entry.path.includes('.worktrees') ? null : (
              <StripMenuItem icon={<Trash2 size={12} />} label="remove worktree" danger onClick={() => { setStripMenu(null); handleRemoveWorktree(stripMenu.entry.path) }} />
            )}
          </div>
        </>
      )}

      {completeTarget && (
        <CompleteWorktreeDialog
          worktreePath={completeTarget.path}
          repoPath={repoPath!}
          onClose={() => setCompleteTarget(null)}
          onDone={() => { setCompleteTarget(null); loadWorktrees() }}
        />
      )}

      {showNewWorktree && repoPath && (
        <NewWorktreeDialog
          repoPath={repoPath}
          onClose={() => setShowNewWorktree(false)}
          onCreated={() => { setShowNewWorktree(false); loadWorktrees() }}
        />
      )}
    </PanelContainer>
  )
}

function StripMenuItem({ icon, label, onClick, danger }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <div onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px',
        fontSize: '11px', fontFamily: 'var(--font-mono)', cursor: 'pointer',
        color: danger ? 'var(--error-color)' : 'var(--text-primary)',
        transition: 'background 0.1s ease'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'var(--error-bg)' : 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
      {icon}
      {label}
    </div>
  )
}
