import { useEffect, useState, useCallback, useRef } from 'react'
import { PanelContainer } from '../layout/PanelContainer'
import { ResizableSplitter } from '../layout/ResizableSplitter'
import { WorktreeList } from './WorktreeList'
import { WorktreeChanges, type WorktreeChangesHandle } from './WorktreeChanges'
import { TerminalDock } from '../terminal/TerminalDock'
import { CompleteWorktreeDialog } from './CompleteWorktreeDialog'
import { NewWorktreeDialog } from './NewWorktreeDialog'
import { FileTree } from '../editor/FileTree'
import { FileFilterBar } from '../editor/CodeEditor'
import { Modal } from '../layout/Modal'
import { useWorktreeStore, useToastStore } from '../../store'
import { useI18n } from '../../i18n'
import { FolderOpen, Plus, RefreshCw, PanelLeftClose, PanelLeftOpen, FolderTree, ChevronUp, ChevronDown, GitPullRequest, EyeOff, Eye, Trash2, AlertTriangle } from 'lucide-react'
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
  const t = useI18n()
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
  const [removeConfirm, setRemoveConfirm] = useState<{ path: string; error?: string } | null>(null)
  const [isForcingRemove, setIsForcingRemove] = useState(false)
  const [showNewWorktree, setShowNewWorktree] = useState(false)
  const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(new Set())
  const changesHandleRef = useRef<WorktreeChangesHandle | null>(null)
  const showToast = useToastStore(s => s.showToast)

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
    // First attempt: plain removal. If the folder is locked (open in a terminal,
    // Explorer, another app) it fails and we ask for confirmation before forcing.
    const res = await window.electronAPI.worktree.remove(repoPath, path)
    if (!res.ok) {
      setRemoveConfirm({ path, error: res.error })
      return
    }
    if (res.warning) showToast(res.warning, 'error')
    loadWorktrees()
  }

  const handleForceRemoveWorktree = async () => {
    if (!repoPath || !removeConfirm) return
    setIsForcingRemove(true)
    try {
      const res = await window.electronAPI.worktree.remove(repoPath, removeConfirm.path, true)
      if (res.warning) showToast(res.warning, 'error')
      else showToast('worktree removed')
    } catch (e) {
      showToast((e as Error).message || 'rimozione fallita', 'error')
    } finally {
      setIsForcingRemove(false)
      setRemoveConfirm(null)
      loadWorktrees()
    }
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

  const stripBtn = (onClick: () => void, title: string, children: React.ReactNode, tipDesc?: string) => (
    <button onClick={onClick} title={title} data-tip-desc={tipDesc}
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
        {stripBtn(() => setListCollapsed(!listCollapsed), listCollapsed ? 'show panel' : 'collapse panel', listCollapsed ? <PanelLeftOpen size={12} /> : <PanelLeftClose size={12} />, 'collapse or expand the list panel')}
        {stripBtn(loadWorktrees, 'refresh', <RefreshCw size={11} />, 'reload the worktree list')}
      </div>
      {/* worktree tabs */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', overflow: 'auto', padding: '0 2px', width: '100%' }}>
        {entries.filter(e => !hiddenPaths.has(e.path)).map((entry) => {
          const isMain = !entry.path.includes('.worktrees')
          const isSelected = selectedWorktree === entry.path
          const label = shortBranch(entry.branch)
          const isBugfix = entry.branch.includes('bugfix')
          return (
            <div key={entry.path}
              onClick={() => selectWorktree(isSelected ? null : entry.path)}
              onContextMenu={(e) => { e.preventDefault(); setStripMenu({ x: e.clientX, y: e.clientY, entry }) }}
              title={entry.branch || entry.head.substring(0, 7)} data-tip-desc="select this worktree"
              style={{
                width: '30px', height: '22px', borderRadius: '4px', flexShrink: 0,
                background: isSelected ? 'var(--bg-active)' : 'transparent',
                border: `1.5px solid ${isSelected
                  ? (isBugfix ? 'var(--warning-color)' : 'var(--accent-color)')
                  : (isBugfix ? 'var(--warning-color)' : 'var(--border-color)')}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', fontSize: 'calc(8px * var(--ui-text-scale, 1))', fontWeight: 700,
                fontFamily: 'var(--font-mono)', color: isBugfix ? 'var(--warning-color)' : (isSelected ? 'var(--accent-color)' : 'var(--text-muted)'),
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                if (!isSelected) { e.currentTarget.style.borderColor = 'var(--text-secondary)'; e.currentTarget.style.color = 'var(--text-secondary)' }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) { e.currentTarget.style.borderColor = isBugfix ? 'var(--warning-color)' : 'var(--border-color)'; e.currentTarget.style.color = isBugfix ? 'var(--warning-color)' : 'var(--text-muted)' }
              }}>
              {isMain ? 'main' : label.substring(0, 4)}
            </div>
          )
        })}
        {stripBtn(() => setShowNewWorktree(true), 'new worktree', <Plus size={13} />, 'create a feature or bugfix worktree')}
      </div>
      {/* bottom: change main folder */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border-subtle)', paddingTop: '4px', width: '100%', display: 'flex', justifyContent: 'center' }}>
        {stripBtn(async () => {
          const p = await window.electronAPI.dialog.openFolder()
          if (p) onRepoSelected(p)
        }, 'change main folder', <FolderOpen size={13} />, 'open a different repository folder as the main root')}
      </div>
    </div>
  )

  if (!repoPath) {
    return (
      <PanelContainer>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', flex: 1, minHeight: 0, gap: '20px', color: 'var(--text-muted)'
          }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FolderOpen size={28} strokeWidth={1} />
            </div>
            <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
              <p style={{ margin: '0 0 4px', fontSize: 'calc(13px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>{t('open a git repository')}</p>
              <p style={{ margin: 0, fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>{t('to manage worktrees')}</p>
            </div>
            <button onClick={async () => { const p = await window.electronAPI.dialog.openFolder(); if (p) onRepoSelected(p) }}
              style={{ padding: '8px 20px', background: 'var(--accent-color)', color: 'var(--text-inverse)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {t('open repo')}
            </button>
          </div>
          <TerminalDock repoPath={null} />
        </div>
      </PanelContainer>
    )
  }

  return (
    <PanelContainer>
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
                    fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.5px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FolderTree size={12} />
                      {t('worktrees')}
                    </div>
                    <button
                      onClick={() => setWorktreesCollapsed(!worktreesCollapsed)}
                      title={worktreesCollapsed ? 'expand' : 'collapse'} data-tip-desc="expand or collapse the worktrees section"
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
                    fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.5px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FolderOpen size={12} />
                      {t('files')}
                    </div>
                    <button
                      onClick={() => setFilesCollapsed(!filesCollapsed)}
                      title={filesCollapsed ? 'expand' : 'collapse'} data-tip-desc="expand or collapse the files section"
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
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <WorktreeChanges worktreePath={selectedWorktree} repoPath={repoPath} checkMarks={checkMarks[selectedWorktree] || {}} onToggleCheck={(file, state) => handleToggleCheck(selectedWorktree, file, state)} onFileSelected={setExplorerSelectedFile} handleRef={changesHandleRef} />
                  </div>
                  <TerminalDock repoPath={selectedWorktree} />
                </div>
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

      {removeConfirm && (
        <Modal onClose={() => { if (!isForcingRemove) setRemoveConfirm(null) }} width={460} label="remove worktree">
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} style={{ color: 'var(--warning-color)', flexShrink: 0 }} />
              <span style={{ fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t('remove worktree')}
              </span>
            </div>
            <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {t('the worktree folder is locked (probably open in a terminal, Explorer or another program)')}.
              <div style={{ marginTop: '6px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                {removeConfirm.path}
              </div>
              {removeConfirm.error && (
                <div style={{ marginTop: '6px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 'calc(9px * var(--ui-text-scale, 1))', wordBreak: 'break-word' }}>
                  {removeConfirm.error}
                </div>
              )}
            </div>
            <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {t('force removal unregisters the worktree from git; if the folder stays locked you will have to delete it manually')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setRemoveConfirm(null)} disabled={isForcingRemove}
                style={{
                  display: 'flex', alignItems: 'center', padding: '5px 12px', height: '26px',
                  background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)', cursor: isForcingRemove ? 'not-allowed' : 'pointer',
                  fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                }}>
                {t('cancel')}
              </button>
              <button onClick={handleForceRemoveWorktree} disabled={isForcingRemove}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', height: '26px',
                  background: 'var(--error-color)', border: 'none', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-inverse)', cursor: isForcingRemove ? 'not-allowed' : 'pointer',
                  fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                }}>
                <Trash2 size={11} />
                {isForcingRemove ? t('removing…') : t('force remove')}
              </button>
            </div>
          </div>
        </Modal>
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
        fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', cursor: 'pointer',
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
