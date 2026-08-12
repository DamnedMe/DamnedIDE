import { useState, useEffect, useRef } from 'react'
import { PanelContainer } from '../layout/PanelContainer'
import { ResizableSplitter } from '../layout/ResizableSplitter'
import { WorkItemList } from './WorkItemList'
import { WorkItemDetail } from './WorkItemDetail'
import { PullRequestList } from './PullRequestList'
import { PullRequestDetail } from './PullRequestDetail'
import { CreatePrDialog } from './CreatePrDialog'
import { useAdoStore } from '../../store'
import { useI18n } from '../../i18n'
import { AdoConnection, AdoPullRequest, AdoPullRequestDetail } from '../../types/ado'
import { Network, Key, FolderOpen, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'

export function AdoPanel() {
  const { connection, setConnection, workItems, setWorkItems, pullRequests, setPullRequests, isLoading, setLoading } = useAdoStore()
  const t = useI18n()
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<number | null>(null)
  const [selectedPr, setSelectedPr] = useState<AdoPullRequestDetail | null>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [showCreatePr, setShowCreatePr] = useState(false)
  const [org, setOrg] = useState(connection?.organization || '')
  const [project, setProject] = useState(connection?.project || '')
  const [repo, setRepo] = useState(connection?.repository || '')
  const [token, setToken] = useState('')

  const handleConnect = async () => {
    if (!org || !token) return
    setLoading(true)
    try {
      await window.electronAPI.ado.connect(org, token)
      const conn: AdoConnection = { organization: org, project, repository: repo, token, isConnected: true }
      setConnection(conn)

      if (project) {
        const items = await window.electronAPI.ado.workItems(project)
        setWorkItems(items)
      }
      if (project && repo) {
        const prs = await window.electronAPI.ado.pullRequests(project, repo)
        setPullRequests(prs)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSelectPr = async (pr: AdoPullRequest) => {
    setSelectedWorkItemId(null)
    const detail = await window.electronAPI.ado.pullRequestDetail(project, repo, pr.id)
    setSelectedPr(detail)
  }

  const handlePrChanged = async () => {
    if (!selectedPr) return
    const detail = await window.electronAPI.ado.pullRequestDetail(project, repo, selectedPr.id)
    if (!detail || detail.status === 'completed' || detail.status === 'abandoned') {
      setSelectedPr(null)
    } else {
      setSelectedPr(detail)
    }
    window.electronAPI.ado.pullRequests(project, repo).then(setPullRequests).catch(() => {})
  }

  const handlePrCreated = () => {
    setShowCreatePr(false)
    window.electronAPI.ado.pullRequests(project, repo).then(setPullRequests).catch(() => {})
  }

  // Re-initialize the ADO service in the main process from a persisted connection
  useEffect(() => {
    if (!connection?.isConnected) return
    window.electronAPI.ado.connect(connection.organization, connection.token)
      .then(ok => {
        if (!ok) return
        const p = connection.project
        const r = connection.repository
        if (p) window.electronAPI.ado.workItems(p).then(setWorkItems).catch(() => {})
        if (p && r) window.electronAPI.ado.pullRequests(p, r).then(setPullRequests).catch(() => {})
      })
      .catch(() => {})
  }, [])

  if (!connection?.isConnected) {
    return (
      <PanelContainer title={t('ado')}>
        <div style={{
          maxWidth: '420px',
          margin: '0 auto',
          padding: '32px 0'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '24px', color: 'var(--text-secondary)' }}>
            <Network size={32} strokeWidth={1} style={{ marginBottom: '12px' }} />
            <p style={{ margin: 0, fontSize: 'calc(13px * var(--ui-text-scale, 1))' }}>Connettiti ad Azure DevOps</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ fontSize: 'calc(12px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
              Organization
              <input value={org} onChange={e => setOrg(e.target.value)} placeholder="es. revoltech" style={inputStyle} />
            </label>
            <label style={{ fontSize: 'calc(12px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
              Project
              <input value={project} onChange={e => setProject(e.target.value)} placeholder="es. Themis_Platform" style={inputStyle} />
            </label>
            <label style={{ fontSize: 'calc(12px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
              Repository
              <input value={repo} onChange={e => setRepo(e.target.value)} placeholder="es. Themis-API" style={inputStyle} />
            </label>
            <label style={{ fontSize: 'calc(12px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
              Personal Access Token
              <input value={token} onChange={e => setToken(e.target.value)} type="password" placeholder="PAT..." style={inputStyle} />
            </label>
            <button onClick={handleConnect} disabled={isLoading} style={{
              padding: '8px 16px',
              background: isLoading ? 'var(--bg-disabled)' : 'var(--accent-color)',
              color: '#fff', border: 'none', borderRadius: '4px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 500, marginTop: '8px'
            }}>
              {isLoading ? 'Connessione...' : 'Connetti'}
            </button>
          </div>
        </div>
      </PanelContainer>
    )
  }

  const leftRef = useRef<HTMLDivElement>(null)
  const [leftHeight, setLeftHeight] = useState(0)

  useEffect(() => {
    const el = leftRef.current
    if (!el) return
    const update = () => setLeftHeight(el.getBoundingClientRect().height)
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [leftCollapsed])

  return (
    <PanelContainer title={t('ado')}>
      <div style={{ display: 'flex', height: '100%', gap: '4px', overflow: 'hidden' }}>
        {/* Left tool strip — always visible */}
        <div style={{
          width: '36px', flexShrink: 0, background: 'var(--bg-card)',
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          paddingTop: '6px', gap: '4px'
        }}>
          <button onClick={() => setLeftCollapsed(!leftCollapsed)}
            title={leftCollapsed ? 'show left panel' : 'collapse left panel'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', background: 'none', border: 'none',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none' }}>
            {leftCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
          </button>
          <button onClick={() => setShowCreatePr(true)} title="new pull request"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', background: 'none', border: 'none',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--success-color)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none' }}>
            <Plus size={14} />
          </button>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
        <ResizableSplitter direction="horizontal" defaultSize={380} minSize={220} maxSize={700} collapsed={leftCollapsed}>
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
          <div style={{ minWidth: 0, paddingLeft: '4px', overflow: 'hidden', height: '100%' }}>
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
                <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))' }}>select an item to inspect it</span>
              </div>
            )}
          </div>
        </ResizableSplitter>
        </div>
      </div>

      {showCreatePr && (
        <CreatePrDialog project={project} repo={repo} onClose={() => setShowCreatePr(false)} onCreated={handlePrCreated} />
      )}
    </PanelContainer>
  )
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: '4px',
  padding: '7px 10px', background: 'var(--bg-input)',
  border: '1px solid var(--border-color)', borderRadius: '4px',
  color: 'var(--text-primary)', fontSize: 'calc(13px * var(--ui-text-scale, 1))', boxSizing: 'border-box'
}
