import { useState, useEffect, useRef } from 'react'
import { PanelContainer } from '../layout/PanelContainer'
import { ResizableSplitter } from '../layout/ResizableSplitter'
import { WorkItemList } from './WorkItemList'
import { WorkItemDetail } from './WorkItemDetail'
import { PullRequestList } from './PullRequestList'
import { PullRequestDetail } from './PullRequestDetail'
import { CreatePrDialog } from './CreatePrDialog'
import { useAdoStore, adoConnectionFor, loadLegacyAdoConnection } from '../../store'
import { AdoConnection, AdoPullRequest, AdoPullRequestDetail } from '../../types/ado'
import { TerminalDock } from '../terminal/TerminalDock'
import { basenameOf } from '../../utils/paths'
import { Network, PanelLeftClose, PanelLeftOpen, Plus, Settings } from 'lucide-react'

export function AdoPanel({ repoPath }: { repoPath: string | null }) {
  const { connections, setConnection, workItems, setWorkItems, pullRequests, setPullRequests } = useAdoStore()
  const connection = adoConnectionFor(connections, repoPath)
  const project = connection?.project ?? ''
  const repo = connection?.repository ?? ''
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<number | null>(null)
  const [selectedPr, setSelectedPr] = useState<AdoPullRequestDetail | null>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [showCreatePr, setShowCreatePr] = useState(false)
  const [editing, setEditing] = useState(false)
  const showForm = !connection || editing
  // every hook stays above the early returns: a hook count that changes between
  // the form and the connected view crashes React (black screen on save)
  const leftRef = useRef<HTMLDivElement>(null)
  const [leftHeight, setLeftHeight] = useState(0)

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

  // Point the ADO service in the main process at this repository's connection
  // and (re)load its lists: on open and after every save.
  useEffect(() => {
    if (!connection) return
    let cancelled = false
    window.electronAPI.ado.connect(connection.organization, connection.token)
      .then(() => {
        if (cancelled) return
        const { project: p, repository: r } = connection
        if (p) window.electronAPI.ado.workItems(p).then(setWorkItems).catch(() => setWorkItems([]))
        if (p && r) window.electronAPI.ado.pullRequests(p, r).then(setPullRequests).catch(() => setPullRequests([]))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [connection])

  useEffect(() => {
    const el = leftRef.current
    if (!el) return
    const update = () => setLeftHeight(el.getBoundingClientRect().height)
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [leftCollapsed, showForm])

  if (!repoPath || showForm) {
    // a new repository starts from the last saved connection (same org/PAT, usually)
    const template = connection ?? Object.values(connections).pop() ?? loadLegacyAdoConnection()
    return (
      <PanelContainer>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {repoPath ? (
            <AdoConnectForm
              repoName={basenameOf(repoPath)}
              initial={{ ...template, repository: connection?.repository || basenameOf(repoPath) }}
              onSave={(conn) => { setConnection(repoPath, conn); setEditing(false) }}
              onCancel={connection ? () => setEditing(false) : undefined}
            />
          ) : (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '12px', color: 'var(--text-secondary)', fontSize: 'calc(13px * var(--ui-text-scale, 1))'
            }}>
              <Network size={32} strokeWidth={1} />
              apri un repository: la connessione Azure DevOps si configura per repository
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
      <div style={{ display: 'flex', height: '100%', gap: '4px', overflow: 'hidden', flex: 1, minHeight: 0 }}>
        {/* Left tool strip — always visible */}
        <div style={{
          width: '36px', flexShrink: 0, background: 'var(--bg-card)',
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          paddingTop: '6px', gap: '4px'
        }}>
          <button onClick={() => setLeftCollapsed(!leftCollapsed)}
            title={leftCollapsed ? 'show left panel' : 'collapse left panel'} data-tip-desc="collapse or expand the left panel"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', background: 'none', border: 'none',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none' }}>
            {leftCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
          </button>
          <button onClick={() => setShowCreatePr(true)} title="new pull request" data-tip-desc="create a pull request for this branch"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', background: 'none', border: 'none',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--success-color)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none' }}>
            <Plus size={14} />
          </button>
          <button onClick={() => setEditing(true)} title="configure" data-tip-desc="Azure DevOps connection of this repository"
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
        <TerminalDock repoPath={null} />
      </div>
      </div>

      {showCreatePr && (
        <CreatePrDialog project={project} repo={repo} onClose={() => setShowCreatePr(false)} onCreated={handlePrCreated} />
      )}
    </PanelContainer>
  )
}

/** Connection form for one repository: saved only once Azure DevOps answers with its repository. */
function AdoConnectForm({ repoName, initial, onSave, onCancel }: {
  repoName: string
  initial: Partial<AdoConnection>
  onSave: (conn: AdoConnection) => void
  onCancel?: () => void
}) {
  const [org, setOrg] = useState(initial.organization || '')
  const [project, setProject] = useState(initial.project || '')
  const [repo, setRepo] = useState(initial.repository || '')
  const [token, setToken] = useState(initial.token || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    const o = org.trim(), p = project.trim(), r = repo.trim()
    if (!o || !p || !r || !token || saving) return
    setSaving(true)
    setError(null)
    try {
      await window.electronAPI.ado.connect(o, token)
      // a wrong organization/project/PAT must not be saved as a working connection
      const repos = await window.electronAPI.ado.repositories(p)
      if (repos.length === 0) {
        setError('nessuna repository leggibile: controlla organization, project e PAT (scope Code: read)')
        return
      }
      const match = repos.find(x => x.toLowerCase() === r.toLowerCase())
      if (!match) {
        setError(`repository "${r}" non trovata in ${p}. Disponibili: ${repos.join(', ')}`)
        return
      }
      onSave({ organization: o, project: p, repository: match, token, isConnected: true })
    } catch (e) {
      setError((e as Error).message || 'connessione fallita')
    } finally {
      setSaving(false)
    }
  }

  const ready = !!(org.trim() && project.trim() && repo.trim() && token) && !saving
  return (
    <div style={{
      flex: 1, minHeight: 0, overflow: 'auto',
      maxWidth: '420px', width: '100%',
      margin: '0 auto',
      padding: '32px 0'
    }}>
      <div style={{ textAlign: 'center', marginBottom: '24px', color: 'var(--text-secondary)' }}>
        <Network size={32} strokeWidth={1} style={{ marginBottom: '12px' }} />
        <p style={{ margin: 0, fontSize: 'calc(13px * var(--ui-text-scale, 1))' }}>Connetti <b>{repoName}</b> ad Azure DevOps</p>
        <p style={{ margin: '4px 0 0', fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>la configurazione viene salvata per questo repository</p>
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
        {error && (
          <div style={{
            padding: '8px 10px', background: 'var(--error-bg)', color: 'var(--error-color)',
            borderRadius: '4px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', lineHeight: 1.5
          }}>{error}</div>
        )}
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          {onCancel && (
            <button onClick={onCancel} style={{
              flex: 1, padding: '8px 16px', background: 'var(--bg-card)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer',
              fontSize: 'calc(13px * var(--ui-text-scale, 1))'
            }}>Annulla</button>
          )}
          <button onClick={handleSave} disabled={!ready} style={{
            flex: 1, padding: '8px 16px',
            background: ready ? 'var(--accent-color)' : 'var(--bg-disabled)',
            color: '#fff', border: 'none', borderRadius: '4px',
            cursor: ready ? 'pointer' : 'not-allowed',
            fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 500
          }}>
            {saving ? 'Verifica...' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: '4px',
  padding: '7px 10px', background: 'var(--bg-input)',
  border: '1px solid var(--border-color)', borderRadius: '4px',
  color: 'var(--text-primary)', fontSize: 'calc(13px * var(--ui-text-scale, 1))', boxSizing: 'border-box'
}
