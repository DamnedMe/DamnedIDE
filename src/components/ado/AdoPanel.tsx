import { useState, useEffect, useRef } from 'react'
import { PanelContainer } from '../layout/PanelContainer'
import { ResizableSplitter } from '../layout/ResizableSplitter'
import { WorkItemList } from './WorkItemList'
import { WorkItemDetail } from './WorkItemDetail'
import { PullRequestList } from './PullRequestList'
import { PullRequestDetail } from './PullRequestDetail'
import { CreatePrDialog } from './CreatePrDialog'
import { AdoRepoChooser } from './AdoRepoChooser'
import { useAdoStore, useSettingsNavStore, useSettingsStore } from '../../store'
import { useAdoFolder } from '../../hooks/useAdoFolder'
import { AdoPullRequest, AdoPullRequestDetail } from '../../types/ado'
import { TerminalDock } from '../terminal/TerminalDock'
import { AlertTriangle, Network, PanelLeftClose, PanelLeftOpen, Plus, Settings } from '@/components/icons'
import { tr, useI18n } from '../../i18n'

const openAdoSettings = () => useSettingsNavStore.getState().openSettings('ado-connections')

export function AdoPanel({ repoPath }: { repoPath: string | null }) {
  const t = useI18n()
  // Settings › Tema: the side menu docked on the right
  const sidebarRight = useSettingsStore(s => s.settings.sidebarSide === 'right')
  const { workItems, setWorkItems, pullRequests, setPullRequests } = useAdoStore()
  // connection + repository of the open folder (Settings › Azure DevOps)
  const ado = useAdoFolder(repoPath)
  const connection = ado.status === 'ready' ? ado.connection : null
  const connectionId = connection?.id ?? null
  const project = connection?.project ?? ''
  const repo = ado.repository ?? ''
  const ready = !!connectionId && !!project
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<number | null>(null)
  const [selectedPr, setSelectedPr] = useState<AdoPullRequestDetail | null>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [showCreatePr, setShowCreatePr] = useState(false)
  // the main process could not use the connection (PAT missing / unreadable)
  const [useError, setUseError] = useState<string | null>(null)
  // every hook stays above the early returns: a hook count that changes between
  // the chooser and the connected view crashes React (black screen)
  const leftRef = useRef<HTMLDivElement>(null)
  const [leftHeight, setLeftHeight] = useState(0)

  /** The ADO service in the main process serves one connection at a time: point it at this folder's first. */
  const selectConnection = async (): Promise<boolean> =>
    !!connectionId && await window.electronAPI.ado.use(connectionId).catch(() => false)

  const handleSelectPr = async (pr: AdoPullRequest) => {
    setSelectedWorkItemId(null)
    if (!(await selectConnection())) return
    const detail = await window.electronAPI.ado.pullRequestDetail(project, repo, pr.id)
    setSelectedPr(detail)
  }

  const handlePrChanged = async () => {
    if (!selectedPr || !(await selectConnection())) return
    const detail = await window.electronAPI.ado.pullRequestDetail(project, repo, selectedPr.id)
    if (!detail || detail.status === 'completed' || detail.status === 'abandoned') {
      setSelectedPr(null)
    } else {
      setSelectedPr(detail)
    }
    window.electronAPI.ado.pullRequests(project, repo).then(setPullRequests).catch(() => {})
  }

  const handlePrCreated = async () => {
    setShowCreatePr(false)
    if (!(await selectConnection())) return
    window.electronAPI.ado.pullRequests(project, repo).then(setPullRequests).catch(() => {})
  }

  // Point the ADO service in the main process at this folder's connection and
  // (re)load its lists: on open and whenever the connection or repository changes.
  useEffect(() => {
    if (!connectionId || !project) return
    let cancelled = false
    setUseError(null)
    window.electronAPI.ado.use(connectionId)
      .then(ok => {
        if (cancelled) return
        if (!ok) {
          setUseError(tr('PAT missing or unreadable: enter it in Settings › Azure DevOps › Connections'))
          setWorkItems([])
          setPullRequests([])
          return
        }
        window.electronAPI.ado.workItems(project).then(setWorkItems).catch(() => setWorkItems([]))
        if (repo) window.electronAPI.ado.pullRequests(project, repo).then(setPullRequests).catch(() => setPullRequests([]))
      })
      .catch((e) => { if (!cancelled) setUseError((e as Error).message || tr('Azure DevOps unreachable')) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, project, repo])

  useEffect(() => {
    const el = leftRef.current
    if (!el) return
    const update = () => setLeftHeight(el.getBoundingClientRect().height)
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [leftCollapsed, ready])

  if (!repoPath || !ready) {
    return (
      <PanelContainer>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {repoPath ? (
            <AdoRepoChooser state={ado} />
          ) : (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '12px', color: 'var(--text-secondary)', fontSize: 'calc(13px * var(--ui-text-scale, 1))', textAlign: 'center'
            }}>
              <Network size={32} strokeWidth={1} />
              {t('open a repository: Azure DevOps uses the repository named like its folder')}
            </div>
          )}
          <TerminalDock repoPath={null} />
        </div>
      </PanelContainer>
    )
  }

  return (
    <PanelContainer>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {useError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginBottom: '4px', padding: '6px 10px',
          background: 'var(--warning-bg)', border: '1px solid var(--warning-color)', borderRadius: 'var(--radius-sm)',
          color: 'var(--warning-color)', fontSize: 'calc(11px * var(--ui-text-scale, 1))', lineHeight: 1.5
        }}>
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{useError}</span>
          <button onClick={openAdoSettings} title={t('configure in Settings')} data-tip-desc={t('open Settings › Azure DevOps › Connections')}
            style={{
              flexShrink: 0, padding: '2px 8px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', cursor: 'pointer',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
            }}>
            {t('configure in Settings')}
          </button>
        </div>
      )}
      <div style={{ display: 'flex', height: '100%', gap: '4px', overflow: 'hidden', flex: 1, minHeight: 0 }}>
        {/* tool strip next to the lists — always visible */}
        <div style={{
          width: '36px', flexShrink: 0, background: 'var(--bg-card)',
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          paddingTop: '6px', gap: '4px'
        }}>
          <button onClick={() => setLeftCollapsed(!leftCollapsed)}
            title={leftCollapsed ? t('show lists') : t('collapse lists')} data-tip-desc={t('collapse or expand the pull request and work item lists')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', background: 'none', border: 'none',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none' }}>
            {/* the arrow points where the lists go */}
            {leftCollapsed !== sidebarRight ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
          </button>
          {/* use is sent first, so the dialog's own calls already go to this connection */}
          <button onClick={() => { void selectConnection(); setShowCreatePr(true) }} title={t('new pull request')} data-tip-desc={t('create a pull request for this branch')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', background: 'none', border: 'none',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--success-color)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none' }}>
            <Plus size={14} />
          </button>
          <button onClick={openAdoSettings} title={t('Azure DevOps settings')}
            data-tip-desc={t('{org} / {project} · repository {repo}: open Settings › Azure DevOps › Connections', { org: connection?.organization ?? '', project, repo })}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', background: 'none', border: 'none',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none' }}>
            <Settings size={13} />
          </button>
        </div>
        {/* on the right the lists come first, so the tool strip stays next to them */}
        <div style={{ flex: 1, minWidth: 0, order: sidebarRight ? -1 : 0 }}>
        <ResizableSplitter direction="horizontal" defaultSize={380} minSize={220} maxSize={700} collapsed={leftCollapsed} reverse={sidebarRight}>
          <div ref={leftRef} style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
            {leftHeight > 0 && (
              <ResizableSplitter
                direction="vertical"
                defaultSize={Math.round(leftHeight / 2)}
                minSize={90}
                maxSize={Math.max(180, leftHeight - 90)}
              >
                <PullRequestList pullRequests={pullRequests} onSelect={handleSelectPr} selectedId={selectedPr?.id ?? null} />
                <WorkItemList
                  workItems={workItems}
                  onSelect={(id) => { setSelectedWorkItemId(id); setSelectedPr(null) }}
                  selectedId={selectedWorkItemId}
                />
              </ResizableSplitter>
            )}
          </div>
          <div style={{ minWidth: 0, [sidebarRight ? 'paddingRight' : 'paddingLeft']: '4px', overflow: 'hidden', height: '100%' }}>
            {selectedPr ? (
              <PullRequestDetail project={project} repo={repo} pr={selectedPr} onClose={() => setSelectedPr(null)} onChanged={handlePrChanged} />
            ) : selectedWorkItemId ? (
              <WorkItemDetail workItemId={selectedWorkItemId} project={project} />
            ) : (
              <div style={{
                height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', gap: '8px', fontFamily: 'var(--font-mono)'
              }}>
                <Network size={28} strokeWidth={1} />
                <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))' }}>{t('select an item to inspect it')}</span>
              </div>
            )}
          </div>
        </ResizableSplitter>
        </div>
        <TerminalDock repoPath={null} />
      </div>
      </div>

      {showCreatePr && (
        <CreatePrDialog project={project} repo={repo} onClose={() => setShowCreatePr(false)} onCreated={() => void handlePrCreated()} />
      )}
    </PanelContainer>
  )
}
