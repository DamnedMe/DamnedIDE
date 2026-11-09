import { useEffect, useState, useCallback, useRef } from 'react'
import { PanelContainer } from '../layout/PanelContainer'
import { ResizableSplitter } from '../layout/ResizableSplitter'
import { WorktreeChanges, type WorktreeChangesHandle, type WorktreeChangesParts } from './WorktreeChanges'
import { TerminalDock } from '../terminal/TerminalDock'
import { CompleteWorktreeDialog } from './CompleteWorktreeDialog'
import { NewWorktreeDialog } from './NewWorktreeDialog'
import { WorktreeCleanupDialog } from './WorktreeCleanupDialog'
import { worktreeTone, toneColor, overviewSummary, pbiIdFromBranch, isPbiClosed, stripLabel, stripBadge, KIND_COLORS, STACK_LABELS, type StripKind } from './worktree-cleanup'
import { FileTree } from '../editor/FileTree'
import { FileFilterBar } from '../editor/CodeEditor'
import { Modal } from '../layout/Modal'
import { useWorktreeStore, useToastStore, useSettingsNavStore, useSettingsStore } from '../../store'
import { useAdoFolder } from '../../hooks/useAdoFolder'
import { AdoRepoChooser } from '../ado/AdoRepoChooser'
import { useI18n } from '../../i18n'
import type { AdoWorkItem } from '../../types/ado'
import { FolderOpen, Plus, RefreshCw, PanelLeftClose, PanelLeftOpen, GitPullRequest, EyeOff, Eye, Trash2, AlertTriangle, Layers, GitMerge, Eraser, DownloadCloud, Loader2, GitBranch, Bug, Home, ClipboardCheck, GitCommitHorizontal, Check, type AppIcon } from '@/components/icons'
import { WorktreeEntry } from '../../types/worktree'

type CheckState = 'ok' | 'ko'
type CheckMarks = Record<string, Record<string, CheckState>>

interface WorktreePanelProps {
  repoPath: string | null
  onRepoSelected: (path: string) => void
}

/** The main checkout is the entry outside `.worktrees`. */
const isMainPath = (path: string) => !path.includes('.worktrees')
const shortRef = (branch: string) => branch.replace(/^refs\/heads\//, '')
/** stack states where the parent link is stale: the branch can go back on develop */
const isPromotable = (info?: WorktreeStackInfo) => !!info && (info.state === 'merged' || info.state === 'abandoned' || info.state === 'rewritten')

/** Logo of each worktree kind: blurred inside the strip badge, plain in the header. */
const KIND_ICONS: Record<StripKind, AppIcon> = {
  main: Home, pbi: ClipboardCheck, bug: Bug, branch: GitBranch, detached: GitCommitHorizontal
}

const chip = (color: string, background: string): React.CSSProperties => ({
  flexShrink: 0, padding: '1px 8px', borderRadius: '10px', color, background,
  fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 600, whiteSpace: 'nowrap'
})

const chainBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '3px', padding: '1px 7px',
  background: 'var(--bg-card)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
  cursor: 'pointer', fontSize: 'inherit', fontFamily: 'inherit', fontWeight: 600
}

export function WorktreePanel({ repoPath, onRepoSelected }: WorktreePanelProps) {
  // Settings › Tema: the side menu docked on the right
  const sidebarRight = useSettingsStore(s => s.settings.sidebarSide === 'right')
  const { entries, setEntries, selectedWorktree, isLoading, setLoading, selectWorktree } = useWorktreeStore()
  const t = useI18n()
  const [listCollapsed, setListCollapsed] = useState(false)
  const [leftTab, setLeftTab] = useState<'changes' | 'files'>('changes')
  const [checkMarks, setCheckMarks] = useState<CheckMarks>({})
  const [explorerSelectedFile, setExplorerSelectedFile] = useState<string | null>(null)
  const [fileFilter, setFileFilter] = useState('')
  const [filterMode, setFilterMode] = useState<'startsWith' | 'like' | 'regex'>('like')
  const [filterCaseSensitive, setFilterCaseSensitive] = useState(false)
  const [filterSpaceSensitive, setFilterSpaceSensitive] = useState(false)
  const [stripMenu, setStripMenu] = useState<{ x: number; y: number; entry: WorktreeEntry } | null>(null)
  const [completeTarget, setCompleteTarget] = useState<WorktreeEntry | null>(null)
  const [removeConfirm, setRemoveConfirm] = useState<{ path: string; error?: string } | null>(null)
  const [isForcingRemove, setIsForcingRemove] = useState(false)
  const [stack, setStack] = useState<Record<string, WorktreeStackInfo>>({})
  // git status per worktree path: strip/header colors, ahead/behind
  const [overview, setOverview] = useState<Record<string, WorktreeOverview>>({})
  const [showCleanup, setShowCleanup] = useState(false)
  const [isFetchingAll, setIsFetchingAll] = useState(false)
  const [removeGuard, setRemoveGuard] = useState<{ path: string; branch: string; children: WorktreeStackInfo[] } | null>(null)
  const [retargetOnRemove, setRetargetOnRemove] = useState(true)
  const [showNewWorktree, setShowNewWorktree] = useState(false)
  // ponytail: hidden worktrees live in memory only (lost on reload, as before); persist per repo if people rely on it
  const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  // PBI of each branch id (header title and state, badge tooltips); empty without ADO
  const [pbiItems, setPbiItems] = useState<Record<number, AdoWorkItem>>({})
  // bumped by every worktree list load: one ADO batch each (not one per remount)
  const [pbiLoad, setPbiLoad] = useState(0)
  // Azure DevOps connection + repository of the main folder (Settings › Azure DevOps)
  const ado = useAdoFolder(repoPath)
  const adoConnection = ado.status === 'ready' ? ado.connection : null
  const adoReady = !!adoConnection
  const changesHandleRef = useRef<WorktreeChangesHandle | null>(null)
  // the repository on screen now: an answer for the previous one (switched from the title bar mid-fetch) is dropped
  const repoRef = useRef(repoPath)
  repoRef.current = repoPath
  const showToast = useToastStore(s => s.showToast)

  const filter = fileFilter
    ? { query: fileFilter, mode: filterMode, caseSensitive: filterCaseSensitive, spaceSensitive: filterSpaceSensitive }
    : null

  const refreshWorktrees = async () => {
    if (!repoPath) return
    const list = await window.electronAPI.worktree.list(repoPath)
    if (repoRef.current !== repoPath) return
    setEntries(list)
    setPbiLoad(n => n + 1)
    // forget removed worktrees (a recreated one must not start hidden)
    const isListed = (p: string) => list.some(e => e.path === p)
    setHiddenPaths(prev => new Set([...prev].filter(isListed)))
    const hidden = [...hiddenPaths].filter(isListed)
    if (hidden.length === 0) setShowHidden(false)
    const selected = useWorktreeStore.getState().selectedWorktree
    if (!selected || !isListed(selected)) {
      // nothing valid selected (first load, other repository, worktree removed):
      // the main checkout (the repository with the same name as the open folder), else the first visible
      const visible = list.filter(e => !hidden.includes(e.path))
      selectWorktree((visible.find(e => isMainPath(e.path)) ?? visible[0])?.path ?? null)
    }
  }

  const fetchStack = async () => {
    if (!repoPath) return
    try {
      const list = await window.electronAPI.worktree.stack(repoPath)
      if (repoRef.current === repoPath) setStack(Object.fromEntries(list.map(i => [i.branch, i])))
    } catch {
      if (repoRef.current === repoPath) setStack({})
    }
  }

  /** `paths` refreshes only those worktrees (merged into the current map). */
  const fetchOverview = async (paths?: string[]) => {
    if (!repoPath) return
    try {
      const list = await window.electronAPI.worktree.overview(repoPath, paths ? { paths } : undefined)
      if (repoRef.current !== repoPath) return
      const next = Object.fromEntries(list.map(o => [o.path, o]))
      setOverview(prev => (paths ? { ...prev, ...next } : next))
    } catch {
      if (!paths && repoRef.current === repoPath) setOverview({})
    }
  }

  /**
   * One fetch updates the remote refs of every worktree; --prune drops the refs of
   * branches deleted after their PR, so those worktrees show 'no remote' and the
   * cleanup can offer them.
   */
  const handleFetchAll = async () => {
    if (!repoPath || isFetchingAll) return
    setIsFetchingAll(true)
    try {
      await window.electronAPI.git.fetch(repoPath, { prune: true })
      showToast('fetch completato')
    } catch (e) {
      showToast((e as Error).message || 'fetch fallito', 'error')
    } finally {
      setIsFetchingAll(false)
    }
    if (repoRef.current === repoPath) void loadWorktrees()
  }

  const loadWorktrees = async () => {
    if (!repoPath) return
    setLoading(true)
    try {
      await window.electronAPI.worktree.prune(repoPath).catch(() => {})
      await refreshWorktrees()
      if (repoRef.current !== repoPath) return
      setListError(null)
      void fetchStack()
      void fetchOverview()
    } catch (e) {
      if (repoRef.current !== repoPath) return
      const { entries: listed, selectedWorktree: selected } = useWorktreeStore.getState()
      if (selected && listed.some(x => x.path === selected)) {
        // a refresh that fails keeps the open worktree mounted (its terminals, its diff)
        showToast((e as Error).message || 'elenco worktree non aggiornato', 'error')
      } else {
        // e.g. the opened folder is not a git repository
        setEntries([])
        setListError((e as Error).message)
      }
    } finally {
      setLoading(false)
    }
  }

  const branchOf = (path: string): string =>
    shortRef(entries.find(e => e.path === path)?.branch || '')

  /** Removal with the stacked-children guard: a parent can only go if its
   *  children are re-targeted (or the user accepts leaving them orphaned). */
  const handleRemoveWorktree = async (path: string) => {
    if (!repoPath) return
    const branch = branchOf(path)
    const children = branch ? Object.values(stack).filter(i => i.parent === branch) : []
    if (children.length > 0) {
      setRetargetOnRemove(true)
      setRemoveGuard({ path, branch, children })
      return
    }
    await proceedRemove(path)
  }

  const confirmGuardedRemove = async () => {
    if (!removeGuard || !repoPath) return
    const guard = removeGuard
    setRemoveGuard(null)
    if (retargetOnRemove) {
      try {
        const affected = await window.electronAPI.worktree.retargetChildren(repoPath, guard.branch)
        if (affected.length > 0) showToast(`${affected.length} worktree figli re-targettati su develop`)
      } catch { /* remove anyway */ }
    }
    await proceedRemove(guard.path)
  }

  const proceedRemove = async (path: string) => {
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
      if (res.trashedPath && res.warning) showToast(res.warning, 'info')
      else if (res.warning) showToast(res.warning, 'error')
      else showToast('worktree removed')
    } catch (e) {
      showToast((e as Error).message || 'rimozione fallita', 'error')
    } finally {
      setIsForcingRemove(false)
      setRemoveConfirm(null)
      loadWorktrees()
    }
  }

  /** Align a stacked worktree with its base (merge of the parent or develop). */
  const handleAlign = async (worktreePath: string, info: WorktreeStackInfo) => {
    const merge = await window.electronAPI.git.merge(worktreePath, info.mergeRef)
    if (merge.ok) {
      showToast(`allineato su ${info.mergeRef}`)
      loadWorktrees()
      return
    }
    if (merge.conflicts.length > 0) showToast(`conflitti da risolvere: ${merge.conflicts.join(', ')}`, 'error')
    else showToast(merge.message || 'allineamento fallito', 'error')
  }

  /** Drop the stale stack link and align the branch on develop. */
  const handlePromote = async (entry: WorktreeEntry) => {
    if (!repoPath) return
    const branch = shortRef(entry.branch)
    const res = await window.electronAPI.worktree.promote(repoPath, entry.path)
    if (!res.ok) {
      if (res.conflicts?.length) showToast(`conflitti da risolvere prima di promuovere: ${res.conflicts.join(', ')}`, 'error')
      else showToast(res.error || 'promozione fallita', 'error')
      return
    }
    showToast(`${branch} promosso su develop`)
    loadWorktrees()
  }

  const handleHide = (path: string) => {
    const next = new Set(hiddenPaths).add(path)
    setHiddenPaths(next)
    setStripMenu(null)
    // a hidden worktree is never the selected one: back to the main checkout (or the first visible)
    if (selectedWorktree === path) {
      const visible = entries.filter(e => !next.has(e.path))
      selectWorktree((visible.find(e => isMainPath(e.path)) ?? visible[0])?.path ?? null)
    }
  }

  const handleUnhide = (path: string) => {
    const next = new Set(hiddenPaths)
    next.delete(path)
    setHiddenPaths(next)
    if (next.size === 0) setShowHidden(false)
    setStripMenu(null)
  }

  const handleUnhideAll = () => {
    setHiddenPaths(new Set())
    setShowHidden(false)
    setStripMenu(null)
  }

  /** A hidden worktree is never the selected one: selecting it (dimmed badge, jump to parent) unhides it. */
  const selectEntry = (path: string) => {
    if (hiddenPaths.has(path)) handleUnhide(path)
    selectWorktree(path)
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

  // One ADO batch per worktree list load (and when the connection changes);
  // no ADO, no ids or a failure leave the map empty (branch only, no title).
  useEffect(() => {
    if (pbiLoad === 0) return // nothing listed yet by this mount: the store still holds the previous load
    const ids = [...new Set(entries.map(e => pbiIdFromBranch(e.branch)).filter((id): id is number => id !== null))]
    const connectionId = adoConnection?.id
    const project = adoConnection?.project
    if (!connectionId || !project || ids.length === 0) {
      setPbiItems({})
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        // the main-process ADO service serves one connection at a time
        if (!(await window.electronAPI.ado.use(connectionId))) throw new Error('PAT mancante')
        const list = await window.electronAPI.ado.workItemsBatch(project, ids)
        if (!cancelled) setPbiItems(Object.fromEntries(list.map(i => [i.id, i])))
      } catch {
        if (!cancelled) setPbiItems({})
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pbiLoad, adoConnection?.id, adoConnection?.project])

  const browseFolder = async () => {
    try {
      const p = await window.electronAPI.dialog.openFolder()
      if (p) onRepoSelected(p)
    } catch (e) {
      showToast((e as Error).message || 'apertura cartella fallita', 'error')
    }
  }

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
            <button onClick={() => void browseFolder()}
              style={{ padding: '8px 20px', background: 'var(--accent-color)', color: 'var(--text-inverse)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {t('open repo')}
            </button>
          </div>
          <TerminalDock repoPath={null} />
        </div>
      </PanelContainer>
    )
  }

  const hiddenCount = entries.filter(e => hiddenPaths.has(e.path)).length
  const stripEntries = showHidden ? entries : entries.filter(e => !hiddenPaths.has(e.path))
  const selectedEntry = entries.find(e => e.path === selectedWorktree) ?? null
  // round badges (the selected one a rounded square) and the strip grow with the IDE text scale
  const badgeSize = 'calc(30px * var(--ui-text-scale, 1) + 8px)'

  const stripBtn = (onClick: () => void, title: string, children: React.ReactNode, tipDesc: string, accent = false) => (
    <button onClick={onClick} title={title} data-tip-desc={tipDesc}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: 'calc(20px * var(--ui-text-scale, 1) + 12px)', height: 'calc(16px * var(--ui-text-scale, 1) + 12px)',
        background: accent ? 'var(--accent-bg)' : 'none', border: 'none', borderRadius: 'var(--radius-sm)',
        color: accent ? 'var(--accent-color)' : 'var(--text-muted)', cursor: 'pointer'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)'; if (!accent) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { if (!accent) { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none' } }}>
      {children}
    </button>
  )

  const Strip = (
    <aside aria-label="worktrees" style={{
      width: 'calc(30px * var(--ui-text-scale, 1) + 24px)', flexShrink: 0,
      background: 'var(--bg-sidebar)', [sidebarRight ? 'borderLeft' : 'borderRight']: '1px solid var(--border-color)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '10px 0 8px'
    }}>
      {/* badges: they scroll when they do not fit and push the tools to the bottom;
          the padding keeps the corner bubbles and the ↑/↓ capsules inside the scroll box */}
      <div className="wt-strip-list" style={{ flex: 1, minHeight: 0, width: '100%', overflowY: 'auto', scrollbarWidth: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'calc(6px * var(--ui-text-scale, 1) + 8px)', padding: '6px 0 10px' }}>
        {stripEntries.map((entry) => {
          const isSelected = selectedWorktree === entry.path
          const isHidden = hiddenPaths.has(entry.path)
          const ov = overview[entry.path]
          const pbiId = pbiIdFromBranch(entry.branch)
          const item = pbiId !== null ? pbiItems[pbiId] : undefined
          const badge = stripBadge(entry.branch, isMainPath(entry.path), ov, item?.state)
          const KindIcon = KIND_ICONS[badge.kind]
          const tip = [item ? `#${item.id} ${item.title} (${item.state})` : '', overviewSummary(ov)].filter(Boolean).join(' · ')
          return (
            <button key={entry.path} className={isSelected ? 'wt-badge is-selected' : 'wt-badge'}
              // selecting a dimmed (hidden) badge brings it back: a hidden worktree is never selected
              onClick={() => selectEntry(entry.path)}
              onContextMenu={(e) => { e.preventDefault(); setStripMenu({ x: e.clientX, y: e.clientY, entry }) }}
              title={entry.branch || entry.head.substring(0, 7)} data-tip-desc={tip || 'select this worktree'}
              aria-current={isSelected ? 'true' : undefined}
              style={{
                position: 'relative', width: badgeSize, height: badgeSize, flexShrink: 0, padding: 0,
                // a circle ringed in the kind color; the selected one turns into an accent rounded square
                borderRadius: isSelected ? '32%' : '50%',
                border: `2px ${isHidden ? 'dashed' : 'solid'} ${isSelected ? 'var(--accent-color)' : KIND_COLORS[badge.kind]}`,
                background: isSelected ? 'var(--accent-bg)' : 'var(--bg-card)',
                opacity: isHidden ? 0.4 : badge.done ? 0.5 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
                fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontWeight: 700, lineHeight: 1,
                transition: 'border-radius 0.15s ease, background 0.15s ease'
              }}>
              {/* at the outer strip edge: the badge sits 7.5px in ((24px - 8px - the strip's 1px border) / 2), plus its 2px border, minus 0.5px of subpixel slack (no horizontal scroll) */}
              {isSelected && <span style={{ position: 'absolute', [sidebarRight ? 'right' : 'left']: '-9px', top: '25%', bottom: '25%', width: '3px', borderRadius: sidebarRight ? '3px 0 0 3px' : '0 3px 3px 0', background: 'var(--text-primary)' }} />}
              {/* the kind logo, blurred behind the label; it follows the badge size, not the icon-size setting */}
              <KindIcon style={{
                position: 'absolute', inset: 0, margin: 'auto', width: '74%', height: '74%', zoom: 1,
                color: KIND_COLORS[badge.kind], opacity: 0.42, filter: 'blur(1.2px)', pointerEvents: 'none'
              }} />
              <span style={{ position: 'relative' }}>{stripLabel(entry.branch, isMainPath(entry.path)) || entry.head.substring(0, 5)}</span>
              {badge.dirty && (
                <span style={{
                  position: 'absolute', top: '-6px', right: '-6px', boxSizing: 'border-box',
                  minWidth: 'calc(8px * var(--ui-text-scale, 1) + 8px)', height: 'calc(8px * var(--ui-text-scale, 1) + 8px)', padding: '0 3px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '999px',
                  background: 'var(--error-color)', color: 'var(--text-inverse)', border: '2px solid var(--bg-sidebar)',
                  fontSize: 'calc(8px * var(--ui-text-scale, 1))', fontWeight: 800
                }}>{badge.dirty}</span>
              )}
              {(badge.ahead > 0 || badge.behind > 0) && (
                <span style={{
                  position: 'absolute', left: '50%', bottom: '-10px', transform: 'translateX(-50%)',
                  display: 'flex', alignItems: 'center', gap: '3px', padding: '0 4px', whiteSpace: 'nowrap',
                  height: 'calc(8px * var(--ui-text-scale, 1) + 5px)', borderRadius: '999px',
                  background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)',
                  fontSize: 'calc(8px * var(--ui-text-scale, 1))', fontWeight: 700
                }}>
                  {badge.ahead > 0 && <span style={{ color: 'var(--success-color)' }}>↑{badge.ahead}</span>}
                  {badge.behind > 0 && <span style={{ color: 'var(--info-color)' }}>↓{badge.behind}</span>}
                </span>
              )}
              {/* zoom 1: sized by the text scale like the badge, inside the 7.5px margin */}
              {badge.done && <Check strokeWidth={4} style={{
                position: 'absolute', right: '-6px', bottom: '-6px', zoom: 1, color: 'var(--success-color)',
                width: 'calc(6px * var(--ui-text-scale, 1) + 4px)', height: 'calc(6px * var(--ui-text-scale, 1) + 4px)'
              }} />}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
        {hiddenCount > 0 && stripBtn(() => setShowHidden(s => !s), showHidden ? t('hide hidden') : t('show hidden'),
          <span style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
            {hiddenCount}
          </span>,
          'show the hidden worktrees dimmed; clicking one selects it and unhides it, right-click to unhide it (or all)', showHidden)}
        {stripBtn(loadWorktrees, 'refresh', isLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />, 'reload the worktree list')}
        {stripBtn(handleFetchAll, 'fetch', isFetchingAll ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <DownloadCloud size={14} />, 'fetch (with prune) once for every worktree, then reload the ↑/↓ counts')}
        {stripBtn(() => setShowCleanup(true), t('worktree cleanup'), <Eraser size={14} />, 'list the worktrees that look useless (PBI closed, already merged) and remove them')}
        {stripBtn(() => setShowNewWorktree(true), t('new worktree'), <Plus size={15} />, 'create a feature or bugfix worktree', true)}
      </div>
    </aside>
  )

  const tabBtn = (id: 'changes' | 'files', label: React.ReactNode, tipDesc: string) => {
    const active = leftTab === id
    return (
      <button onClick={() => setLeftTab(id)} title={id} data-tip-desc={tipDesc} aria-pressed={active}
        style={{
          height: 'calc(12px * var(--ui-text-scale, 1) + 14px)', padding: '0 12px', border: 'none',
          borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0', cursor: 'pointer', whiteSpace: 'nowrap',
          background: active ? 'var(--bg-card)' : 'transparent',
          boxShadow: active ? 'inset 0 2px 0 var(--accent-color)' : 'none',
          color: active ? 'var(--text-primary)' : 'var(--text-muted)',
          fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: active ? 700 : 600
        }}>
        {label}
      </button>
    )
  }

  /** Main column of the selected worktree: header, stack row, changes|files column, diff and terminal. */
  const renderMain = (entry: WorktreeEntry) => ({ list, diff, count, conflicts, statusError, syncButtons }: WorktreeChangesParts) => {
    const branch = shortRef(entry.branch)
    const ov = overview[entry.path]
    const tone = toneColor(worktreeTone(ov))
    const pbiId = pbiIdFromBranch(entry.branch)
    const item = pbiId !== null ? pbiItems[pbiId] : undefined
    const kind = stripBadge(entry.branch, isMainPath(entry.path), ov, item?.state).kind
    const KindIcon = KIND_ICONS[kind]
    const closed = isPbiClosed(item?.state)
    const info = stack[branch]
    const meta = info ? STACK_LABELS[info.state] : null
    const parentEntry = info ? entries.find(e => shortRef(e.branch) === info.parent) : undefined
    return (
      <>
        <div style={{
          height: 'calc(13px * var(--ui-text-scale, 1) + 20px)', flexShrink: 0, minWidth: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px 0 6px',
          borderBottom: '1px solid var(--border-color)', fontFamily: 'var(--font-mono)'
        }}>
          {/* a collapsed column has no splitter handle: this is the only way back */}
          <button onClick={() => setListCollapsed(c => !c)}
            title={listCollapsed ? 'show panel' : 'collapse panel'} data-tip-desc="collapse or expand the changes / files column"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 'calc(14px * var(--ui-text-scale, 1) + 10px)', height: 'calc(14px * var(--ui-text-scale, 1) + 10px)', background: 'none', border: 'none', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none' }}>
            {/* the arrow points where the column goes: on the right it closes towards the right */}
            {listCollapsed !== sidebarRight ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
          {/* a long branch truncates (after the PBI title) so pull/push/Completa PR stay on screen */}
          <span title={entry.path} data-tip-desc={overviewSummary(ov) || 'worktree folder'}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', fontWeight: 700, fontSize: 'calc(13px * var(--ui-text-scale, 1))', color: tone ?? 'var(--text-primary)' }}>
            <KindIcon size={14} style={{ color: KIND_COLORS[kind], flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{branch || entry.head.substring(0, 7)}</span>
          </span>
          {item ? (
            <>
              <span title={`#${item.id} ${item.title}`} data-tip-desc={[item.type, item.assignedTo].filter(Boolean).join(' · ') || 'PBI'}
                style={{ minWidth: 0, flexShrink: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 'calc(12px * var(--ui-text-scale, 1))' }}>
                #{item.id} {item.title}
              </span>
              <span title={item.state} data-tip-desc="PBI state in Azure DevOps"
                style={closed ? chip('var(--success-color)', 'var(--success-bg)') : chip('var(--accent-color)', 'var(--accent-bg)')}>
                {item.state}
              </span>
            </>
          ) : pbiId !== null && adoReady && (
            // ADO configured but the item did not come back (still loading, error, unknown id): the id alone
            <span title={`#${pbiId}`} data-tip-desc="PBI not read from Azure DevOps"
              style={{ flexShrink: 0, whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 'calc(12px * var(--ui-text-scale, 1))' }}>
              #{pbiId}
            </span>
          )}
          {ado.status === 'no-connections' && !isMainPath(entry.path) && (
            // the worktree view works without ADO: just a way to set it up
            <button onClick={() => useSettingsNavStore.getState().openSettings('ado-connections')}
              title="Azure DevOps non configurato" data-tip-desc="configura una connessione in Impostazioni › Azure DevOps: titolo e stato dei PBI, pull request da «Completa PR»"
              style={{ ...chip('var(--text-muted)', 'var(--bg-subtle)'), border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              ADO non configurato
            </button>
          )}
          {ado.status === 'none' && ado.errors.length === 0 && !isMainPath(entry.path) && (
            // no repository named like the folder (often a folder that does not use ADO): mappable in Settings, no warning
            <button onClick={() => useSettingsNavStore.getState().openSettings('ado-folders')}
              title="ADO: nessuna repository"
              data-tip-desc={`nessuna repository Azure DevOps si chiama «${ado.folderName}»: se questa cartella ne usa una, associala in Impostazioni › Azure DevOps › Repository per cartella`}
              style={{ ...chip('var(--text-muted)', 'var(--bg-subtle)'), border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              ADO: nessuna repository
            </button>
          )}
          {ov?.upstreamGone && (
            <span title={`nessun branch remoto ${ov.upstream || ''} (rispetto all'ultimo fetch)`} data-tip-desc="mai pubblicato, oppure rimosso dopo il merge della PR"
              style={chip('var(--text-muted)', 'var(--bg-subtle)')}>
              no remote
            </span>
          )}
          {entry.detached && (
            <span title={t('detached')} data-tip-desc="HEAD is not on a branch" style={chip('var(--warning-color)', 'var(--warning-bg)')}>
              {t('detached')}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {syncButtons}
            {!isMainPath(entry.path) && (
              <button onClick={() => setCompleteTarget(entry)}
                title="completa PR" data-tip-desc="stage, commit and push, merge the base, then open the pull request on Azure DevOps"
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0,
                  height: 'calc(11px * var(--ui-text-scale, 1) + 12px)', padding: '0 12px',
                  background: 'var(--accent-color)', color: 'var(--text-inverse)', border: 'none', borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 700
                }}>
                <GitPullRequest size={12} /> Completa PR
              </button>
            )}
          </div>
        </div>
        {info && meta && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', flexShrink: 0,
            padding: '3px 12px', borderBottom: '1px solid var(--border-color)',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
          }}>
            <Layers size={11} style={{ color: meta.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)' }}>develop ›</span>
            <button onClick={() => parentEntry && selectEntry(parentEntry.path)} disabled={!parentEntry}
              title={parentEntry ? `vai al worktree di ${info.parent}` : `${info.parent} non è aperto in un worktree`}
              data-tip-desc="jump to the parent worktree"
              style={{ ...chainBtn, color: parentEntry ? 'var(--accent-color)' : 'var(--text-muted)', cursor: parentEntry ? 'pointer' : 'default' }}>
              {info.parent}
            </button>
            <span style={{ color: 'var(--text-muted)' }}>›</span>
            <span style={{ color: 'var(--accent-color)', fontWeight: 700 }}>{branch}</span>
            <span title={info.detail || meta.tip} data-tip-desc={info.detail || meta.tip}
              style={{ padding: '0 5px', borderRadius: 'var(--radius-sm)', border: `1px solid ${meta.color}`, color: meta.color, fontWeight: 700 }}>
              {meta.label}
            </span>
            {info.behindParent > 0 && (
              <span style={{ color: 'var(--warning-color)' }}>base avanzata (+{info.behindParent})</span>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => handleAlign(entry.path, info)}
              title={`merge ${info.mergeRef} in questo worktree`} data-tip-desc="align this worktree with its base (merge)"
              style={chainBtn}>
              <GitMerge size={9} /> allinea
            </button>
            {isPromotable(info) && (
              <button onClick={() => void handlePromote(entry)}
                title="promuovi su develop: allinea e rimuovi il legame con il padre" data-tip-desc="align on develop and drop the stack link"
                style={chainBtn}>
                promuovi
              </button>
            )}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResizableSplitter direction="horizontal" defaultSize={300} minSize={180} maxSize={600} collapsed={listCollapsed} onCollapse={() => setListCollapsed(true)} reverse={sidebarRight}>
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ display: 'flex', gap: '2px', padding: '6px 8px 0', flexShrink: 0 }}>
                {/* the status error and the conflicts stay visible from the File tab */}
                {tabBtn('changes', (
                  <>
                    {t('Changes')} {statusError ? <span style={{ color: 'var(--error-color)' }}>!</span> : count}
                    {conflicts > 0 && <span style={{ color: 'var(--warning-color)' }}> · ⚠{conflicts}</span>}
                  </>
                ), statusError || 'pending changes of this worktree: stage, commit, transfer, diff')}
                {tabBtn('files', t('Files'), 'every file of this worktree: open one to view or edit it')}
              </div>
              {/* both tabs stay mounted: the list keeps its filter, the tree its expanded folders */}
              <div style={{ flex: 1, minHeight: 0, background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ flex: 1, minHeight: 0, display: leftTab === 'changes' ? 'flex' : 'none', flexDirection: 'column' }}>
                  {list}
                </div>
                <div style={{ flex: 1, minHeight: 0, display: leftTab === 'files' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
                  <FileFilterBar value={fileFilter} onChange={setFileFilter} mode={filterMode} onModeChange={setFilterMode} caseSensitive={filterCaseSensitive} onCaseToggle={() => setFilterCaseSensitive(!filterCaseSensitive)} spaceSensitive={filterSpaceSensitive} onSpaceToggle={() => setFilterSpaceSensitive(!filterSpaceSensitive)} />
                  <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <FileTree rootPath={entry.path} onFileSelect={(f) => changesHandleRef.current?.openFile(f)} selectedFile={explorerSelectedFile} filter={filter} />
                  </div>
                </div>
              </div>
            </div>
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                {diff}
              </div>
              <TerminalDock repoPath={entry.path} />
            </div>
          </ResizableSplitter>
        </div>
      </>
    )
  }

  return (
    <PanelContainer>
      <div style={{ height: '100%', display: 'flex', flexDirection: sidebarRight ? 'row-reverse' : 'row', overflow: 'hidden' }}>
        {Strip}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* the folder's ADO repository is not clear: ask here, in view (PBI titles and PRs need it);
              'none' (no same-name repository) is only a muted chip in the worktree header, unless a
              connection failed (its repositories are unknown: errors and retry stay in view) */}
          {(ado.status === 'ambiguous' || ado.status === 'error' || (ado.status === 'none' && ado.errors.length > 0)) && (
            <div style={{ flexShrink: 0, padding: '6px 8px', borderBottom: '1px solid var(--border-color)' }}>
              <AdoRepoChooser state={ado} compact />
            </div>
          )}
          {selectedEntry ? (
            <WorktreeChanges worktreePath={selectedEntry.path} repoPath={repoPath} checkMarks={checkMarks[selectedEntry.path] || {}} onToggleCheck={(file, state) => handleToggleCheck(selectedEntry.path, file, state)} onFileSelected={setExplorerSelectedFile} handleRef={changesHandleRef}
              onGitChanged={(paths) => void fetchOverview(paths)} sync={overview[selectedEntry.path]} layout={renderMain(selectedEntry)} />
          ) : (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
            }}>
              {isLoading ? (
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
              ) : listError ? (
                <span style={{ color: 'var(--error-color)', lineHeight: 1.7, wordBreak: 'break-word' }}>{listError}</span>
              ) : entries.length === 0 ? t('no worktrees')
                : stripEntries.length === 0 ? t('all worktrees hidden')
                : t('select a worktree')}
            </div>
          )}
        </div>
      </div>

      {stripMenu && (() => {
        const entry = stripMenu.entry
        const info = stack[shortRef(entry.branch)]
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setStripMenu(null)} />
            <div style={{
              // clamped: with the side menu on the right a right-click lands at the window edge
              position: 'fixed', left: Math.min(stripMenu.x, window.innerWidth - 190), top: stripMenu.y, zIndex: 200,
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)', padding: '4px 0', minWidth: '180px',
              boxShadow: 'var(--shadow-lg)', animation: 'fadeIn 0.1s ease'
            }}>
              {hiddenPaths.has(entry.path) ? (
                <>
                  <StripMenuItem icon={<Eye size={12} />} label={t('unhide')} onClick={() => handleUnhide(entry.path)} />
                  <StripMenuItem icon={<Eye size={12} />} label={t('unhide all')} onClick={handleUnhideAll} />
                </>
              ) : (
                <StripMenuItem icon={<EyeOff size={12} />} label={t('hide from list')} onClick={() => handleHide(entry.path)} />
              )}
              <StripMenuItem icon={<GitPullRequest size={12} />} label={t('completa worktree')} onClick={() => handleComplete(entry)} />
              {info && (
                <StripMenuItem icon={<GitMerge size={12} />} label="allinea"
                  onClick={() => { setStripMenu(null); void handleAlign(entry.path, info) }} />
              )}
              {isPromotable(info) && (
                <StripMenuItem icon={<Layers size={12} />} label="promuovi su develop"
                  onClick={() => { setStripMenu(null); void handlePromote(entry) }} />
              )}
              {!isMainPath(entry.path) && (
                <StripMenuItem icon={<Trash2 size={12} />} label={t('remove worktree')} danger onClick={() => { setStripMenu(null); handleRemoveWorktree(entry.path) }} />
              )}
            </div>
          </>
        )
      })()}

      {completeTarget && (
        <CompleteWorktreeDialog
          worktreePath={completeTarget.path}
          branch={completeTarget.branch}
          repoPath={repoPath}
          // the flow may have committed, pushed or dropped the stack link without removing the worktree
          onClose={() => { setCompleteTarget(null); void fetchOverview(); void fetchStack() }}
          onDone={() => { setCompleteTarget(null); loadWorktrees() }}
        />
      )}

      {showNewWorktree && (
        <NewWorktreeDialog
          repoPath={repoPath}
          worktrees={entries}
          onClose={() => setShowNewWorktree(false)}
          onCreated={() => { setShowNewWorktree(false); loadWorktrees() }}
        />
      )}

      {showCleanup && (
        <WorktreeCleanupDialog
          repoPath={repoPath}
          onClose={() => setShowCleanup(false)}
          onDone={() => { void loadWorktrees() }}
        />
      )}

      {removeGuard && (
        <Modal onClose={() => setRemoveGuard(null)} width={520} label="remove stacked worktree">
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={16} style={{ color: 'var(--warning-color)', flexShrink: 0 }} />
              <span style={{ fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
                {removeGuard.branch} ha worktree impilati
              </span>
            </div>
            <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Questi worktree nascono da <b>{removeGuard.branch}</b>:
              <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {removeGuard.children.map(c => (
                  <li key={c.branch}>
                    {c.branch}
                    {c.behindParent > 0 ? ` (+${c.behindParent} dalla base)` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer',
              fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)'
            }}>
              <input type="checkbox" checked={retargetOnRemove} onChange={(e) => setRetargetOnRemove(e.target.checked)} />
              re-target dei figli su develop (rimuove il legame con il padre)
            </label>
            {!retargetOnRemove && (
              <div style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--warning-color)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
                i figli resteranno con un legame verso un branch che non esiste più (badge "padre mancante")
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setRemoveGuard(null)}
                style={{
                  display: 'flex', alignItems: 'center', padding: '5px 12px', height: '26px',
                  background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                  fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                }}>
                {t('cancel')}
              </button>
              <button onClick={confirmGuardedRemove}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', height: '26px',
                  background: 'var(--error-color)', border: 'none', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-inverse)', cursor: 'pointer',
                  fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                }}>
                <Trash2 size={11} /> rimuovi
              </button>
            </div>
          </div>
        </Modal>
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
