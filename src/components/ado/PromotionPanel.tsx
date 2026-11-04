import { useEffect, useState } from 'react'
import { Rocket, Loader2, RotateCw, ChevronRight, ChevronDown, GitPullRequest, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { PanelContainer } from '../layout/PanelContainer'
import { Modal } from '../layout/Modal'
import { TerminalDock } from '../terminal/TerminalDock'
import { useAdoStore, adoConnectionFor, usePromotionStore, useToastStore } from '../../store'
import type { AdoPullRequest, AdoWorkItem } from '../../types/ado'
import {
  STAGE_ROLES,
  resolveEnvBranch,
  extractWorkItemIds,
  promotionTitle,
  promotionDescription,
  promotionConfigKey,
  firstLine,
  type EnvRole,
  type PromotionStage,
  type PromotionScope
} from '../../shared/adoPromotion'

type Side = 'BE' | 'FE'

interface Commit { commitId: string; message: string; author: string }

/** What one repository would promote, as read from Azure DevOps. */
interface RepoPreview {
  side: Side
  repo: string
  branches: string[]
  source: string | null
  target: string | null
  commits: Commit[]
  workItems: AdoWorkItem[]
  existing: AdoPullRequest | null
  warning?: string
  error?: string
  status?: 'running' | 'ok' | 'error'
  created?: { id: number; url: string; mode: 'autocomplete' | 'completed' | 'open' }
}

type ReadyPreview = RepoPreview & { source: string; target: string }

/** ADO branch and repository names compare case-insensitively */
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Release promotion: one pull request per repository (BE = this repository's
 * Azure DevOps connection, FE = a repository of the same project) from develop
 * to qa or from qa to prod, with the work items found in the commits linked.
 */
export function PromotionPanel({ repoPath, onConfigureAdo }: { repoPath: string | null; onConfigureAdo: () => void }) {
  const connections = useAdoStore(s => s.connections)
  const setPullRequests = useAdoStore(s => s.setPullRequests)
  const configs = usePromotionStore(s => s.configs)
  const setConfig = usePromotionStore(s => s.setConfig)
  const showToast = useToastStore(s => s.showToast)

  const connection = adoConnectionFor(connections, repoPath)
  const org = connection?.organization ?? ''
  const project = connection?.project ?? ''
  const token = connection?.token ?? ''
  const beRepo = connection?.repository ?? ''
  const configKey = connection ? promotionConfigKey(org, project) : ''
  const config = configs[configKey] ?? {}
  // FE is picked once per org/project; until then, another repository saved with the same org/project
  const feSuggestion = connection
    ? Object.values(connections).find(c =>
        promotionConfigKey(c.organization, c.project) === configKey && !!c.repository && !sameName(c.repository, beRepo)
      )?.repository ?? ''
    : ''
  const feRepo = config.feRepo ?? feSuggestion

  // every hook stays above the early return (no ErrorBoundary: a hook-order bug blanks the app)
  const [stage, setStage] = useState<PromotionStage>('dev-qa')
  const [scope, setScope] = useState<PromotionScope>('be')
  const [repos, setRepos] = useState<string[]>([])
  const [previews, setPreviews] = useState<RepoPreview[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  // unticked work items, as `${side}:${id}`
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [openCommits, setOpenCommits] = useState<Set<Side>>(() => new Set())
  const [autoComplete, setAutoComplete] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [creating, setCreating] = useState(false)

  const roles = STAGE_ROLES[stage]
  const targets: { side: Side; repo: string }[] = []
  if (scope !== 'fe' && beRepo) targets.push({ side: 'BE', repo: beRepo })
  if (scope !== 'be' && feRepo) targets.push({ side: 'FE', repo: feRepo })
  const targetsKey = targets.map(t => `${t.side}=${t.repo}`).join('|')
  const overridesKey = JSON.stringify(config.branches ?? {})

  // repositories of the project, for the FE picker
  useEffect(() => {
    if (!connection) return
    let cancelled = false
    window.electronAPI.ado.connect(org, token)
      .then(() => window.electronAPI.ado.repositories(project))
      .then(list => { if (!cancelled) setRepos(list) })
      .catch(() => { if (!cancelled) setRepos([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection])

  const loadPreview = async (side: Side, repo: string): Promise<RepoPreview> => {
    const api = window.electronAPI.ado
    const base: RepoPreview = { side, repo, branches: [], source: null, target: null, commits: [], workItems: [], existing: null }
    try {
      const branches = await api.branches(project, repo)
      if (branches.length === 0) return { ...base, error: `nessun branch letto da ${repo}: controlla repository e PAT` }
      const overrides = config.branches?.[repo] ?? {}
      const source = resolveEnvBranch(roles.from, branches, overrides[roles.from])
      const target = resolveEnvBranch(roles.to, branches, overrides[roles.to])
      if (!source || !target) return { ...base, branches, source, target }
      const commits = await api.commitsBetween(project, repo, source, target)
      const ids = extractWorkItemIds(commits.map(c => c.message))
      let workItems: AdoWorkItem[] = []
      let warning: string | undefined
      if (ids.length > 0) {
        try {
          workItems = await api.workItemsBatch(project, ids)
        } catch {
          warning = 'work item non letti: la PR verrebbe creata senza link ai work item'
        }
      }
      const existing = (await api.pullRequests(project, repo))
        .find(p => sameName(p.sourceBranch, source) && sameName(p.targetBranch, target)) ?? null
      return { ...base, branches, source, target, commits, workItems, existing, warning }
    } catch (e) {
      return { ...base, error: (e as Error).message || 'lettura da Azure DevOps fallita' }
    }
  }

  useEffect(() => {
    setPreviews([])
    setExcluded(new Set())
    const active = !!connection && targets.length > 0
    setLoading(active)
    if (!active) return
    let cancelled = false
    ;(async () => {
      const out: RepoPreview[] = []
      try {
        await window.electronAPI.ado.connect(org, token)
        // one repository after the other: the ADO service holds a single connection
        for (const { side, repo } of targets) {
          const preview = await loadPreview(side, repo)
          if (cancelled) return
          out.push(preview)
          setPreviews([...out])
        }
      } catch (e) {
        if (!cancelled) showToast((e as Error).message || 'Azure DevOps non raggiungibile', 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, stage, targetsKey, overridesKey, reloadTick])

  const setBranchOverride = (repo: string, role: EnvRole, branch: string) => {
    setConfig(configKey, { ...config, branches: { ...config.branches, [repo]: { ...config.branches?.[repo], [role]: branch } } })
  }

  const setFeRepo = (repo: string) => setConfig(configKey, { ...config, feRepo: repo })

  const patchPreview = (side: Side, patch: Partial<RepoPreview>) =>
    setPreviews(prev => prev.map(p => p.side === side ? { ...p, ...patch } : p))

  const selectedItems = (p: RepoPreview) => p.workItems.filter(w => !excluded.has(`${p.side}:${w.id}`))

  const toggleItem = (key: string) => setExcluded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const toggleCommits = (side: Side) => setOpenCommits(prev => {
    const next = new Set(prev)
    if (next.has(side)) next.delete(side)
    else next.add(side)
    return next
  })

  const prWebUrl = (repo: string, pr: AdoPullRequest) =>
    pr.url || `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${pr.id}`

  const openUrl = (url: string) => { window.electronAPI.shell.openExternal(url).catch(() => {}) }

  const creatable = previews.filter((p): p is ReadyPreview =>
    !!p.source && !!p.target && !p.error && p.commits.length > 0 && !p.existing && !p.created)

  const create = async () => {
    setConfirming(false)
    if (creating || creatable.length === 0) return
    setCreating(true)
    const api = window.electronAPI.ado
    const done: string[] = []
    const failed: string[] = []
    try {
      await api.connect(org, token)
      for (const p of creatable) {
        patchPreview(p.side, { status: 'running' })
        const items = selectedItems(p)
        const res = await api.createPr(project, p.repo, {
          sourceRef: p.source,
          targetRef: p.target,
          title: promotionTitle(p.source, p.target, p.side, new Date()),
          description: promotionDescription(items, p.commits),
          autoComplete,
          workItemIds: items.length > 0 ? items.map(w => w.id) : undefined,
          // develop / qa are never deleted and branch policies are never bypassed
          deleteSourceBranch: false,
          forceComplete: false
        }).catch(() => null)
        if (res) {
          done.push(`${p.side} #${res.id}`)
          patchPreview(p.side, { status: 'ok', created: { id: res.id, url: res.url, mode: res.mode } })
        } else {
          failed.push(p.side)
          patchPreview(p.side, { status: 'error' })
        }
      }
      if (creatable.some(p => p.repo === beRepo)) api.pullRequests(project, beRepo).then(setPullRequests).catch(() => {})
    } catch (e) {
      showToast((e as Error).message || 'Azure DevOps non raggiungibile', 'error')
    } finally {
      setCreating(false)
    }
    if (failed.length === 0 && done.length > 0) showToast(`PR di rilascio create: ${done.join(', ')}`)
    else if (failed.length > 0) showToast(`PR create: ${done.join(', ') || 'nessuna'} · fallite: ${failed.join(', ')}`, 'error')
  }

  const handleCreate = () => {
    if (stage === 'qa-prod') setConfirming(true)
    else void create()
  }

  if (!repoPath || !connection) {
    return (
      <PanelContainer>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '12px', color: 'var(--text-secondary)', fontSize: 'calc(13px * var(--ui-text-scale, 1))', textAlign: 'center'
          }}>
            <Rocket size={32} strokeWidth={1} />
            {repoPath
              ? 'Azure DevOps non è configurato per questo repository: il rilascio usa la sua connessione'
              : 'apri un repository: il rilascio usa la sua connessione Azure DevOps'}
            {repoPath && (
              <button onClick={onConfigureAdo} title="configure Azure DevOps" data-tip-desc="open the Azure DevOps panel to connect this repository"
                style={{ ...primaryBtnStyle, background: 'var(--accent-color)', color: 'var(--text-inverse)', cursor: 'pointer' }}>
                configura Azure DevOps
              </button>
            )}
          </div>
          <TerminalDock repoPath={null} />
        </div>
      </PanelContainer>
    )
  }

  const branchPicker = (p: RepoPreview, role: EnvRole, value: string | null) => (
    p.branches.length === 0 ? (
      <span style={{ fontFamily: 'var(--font-mono)' }}>{value ?? role}</span>
    ) : (
      <select value={value ?? ''} disabled={creating}
        onChange={(e) => setBranchOverride(p.repo, role, e.target.value)}
        title={`${role} branch`} data-tip-desc={`branch used as ${role} in ${p.repo} (saved for this repository)`}
        style={{
          ...compactInputStyle,
          borderColor: value ? 'var(--border-color)' : 'var(--warning-color)',
          color: value ? 'var(--text-primary)' : 'var(--warning-color)'
        }}>
        {!value && <option value="">{role}?</option>}
        {p.branches.map(b => <option key={b} value={b}>{b}</option>)}
      </select>
    )
  )

  const renderCard = (p: RepoPreview) => {
    const ready = !!p.source && !!p.target && !p.error
    const locked = !!p.existing || !!p.created || creating
    const commitsOpen = openCommits.has(p.side)
    return (
      <div key={p.side} style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: 'calc(12px * var(--ui-text-scale, 1))' }}>
          <span style={tagStyle}>{p.side}</span>
          <b style={{ color: 'var(--text-primary)' }}>{p.repo}</b>
          {branchPicker(p, roles.from, p.source)}
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          {branchPicker(p, roles.to, p.target)}
          {ready && (
            <span style={{ color: 'var(--text-muted)', fontSize: 'calc(11px * var(--ui-text-scale, 1))' }}>
              · {p.commits.length} commit · {p.workItems.length} work item
            </span>
          )}
          <span style={{ flex: 1 }} />
          {p.status === 'running' && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />}
          {p.existing && (
            <button onClick={() => openUrl(prWebUrl(p.repo, p.existing!))} title="open in Azure DevOps" data-tip-desc="an active pull request with the same source and target already exists: no new one is created"
              style={{ ...badgeBtnStyle, background: 'var(--warning-bg)', color: 'var(--warning-color)' }}>
              PR #{p.existing.id} già attiva ↗
            </button>
          )}
          {p.created && (
            <button onClick={() => openUrl(p.created!.url)} title="open in Azure DevOps" data-tip-desc="the pull request just created"
              style={{ ...badgeBtnStyle, background: 'var(--success-bg)', color: 'var(--success-color)' }}>
              <CheckCircle2 size={10} /> PR #{p.created.id} {p.created.mode === 'autocomplete' ? 'creata (auto-complete)' : 'creata'} ↗
            </button>
          )}
        </div>

        {p.error && <div style={{ ...noteStyle, background: 'var(--error-bg)', color: 'var(--error-color)' }}><XCircle size={11} style={noteIconStyle} />{p.error}</div>}
        {!p.error && (!p.source || !p.target) && (
          <div style={{ ...noteStyle, background: 'var(--warning-bg)', color: 'var(--warning-color)' }}>
            <AlertTriangle size={11} style={noteIconStyle} />
            branch {!p.source ? roles.from : roles.to} non trovato in {p.repo}: sceglilo dall'elenco (resta salvato per questa repository)
          </div>
        )}
        {p.warning && <div style={{ ...noteStyle, background: 'var(--warning-bg)', color: 'var(--warning-color)' }}><AlertTriangle size={11} style={noteIconStyle} />{p.warning}</div>}
        {p.status === 'error' && (
          <div style={{ ...noteStyle, background: 'var(--error-bg)', color: 'var(--error-color)' }}>
            <XCircle size={11} style={noteIconStyle} />
            creazione PR fallita: controlla branch policies e permessi del PAT (dettaglio nel log dell'app)
          </div>
        )}
        {ready && p.commits.length === 0 && !p.existing && (
          <div style={{ color: 'var(--text-muted)', fontSize: 'calc(11px * var(--ui-text-scale, 1))' }}>
            nulla da promuovere: {p.target} contiene già tutti i commit di {p.source}
          </div>
        )}

        {p.workItems.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {p.workItems.map(w => {
              const key = `${p.side}:${w.id}`
              return (
                <label key={w.id} style={{
                  display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0,
                  fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)',
                  cursor: locked ? 'default' : 'pointer'
                }}>
                  <input type="checkbox" checked={!excluded.has(key)} disabled={locked}
                    onChange={() => toggleItem(key)} style={{ accentColor: 'var(--accent-color)', margin: 0 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', flexShrink: 0 }}>#{w.id}</span>
                  {w.type && <span style={{ ...tagStyle, fontWeight: 500 }}>{w.type}</span>}
                  {w.state && <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{w.state}</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
                </label>
              )
            })}
          </div>
        )}

        {p.commits.length > 0 && (
          <div>
            <button onClick={() => toggleCommits(p.side)} title={commitsOpen ? 'hide commits' : 'show commits'} data-tip-desc="commits that the pull request brings into the target branch"
              style={{
                display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', padding: 0,
                color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
              }}>
              {commitsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {p.commits.length} commit
            </button>
            {commitsOpen && (
              <div style={{
                marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '1px', maxHeight: '220px', overflow: 'auto',
                fontFamily: 'var(--font-mono)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)'
              }}>
                {p.commits.map(c => (
                  <div key={c.commitId} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{c.commitId.slice(0, 8)}</span> {firstLine(c.message)}
                    {c.author && <span style={{ color: 'var(--text-muted)' }}> — {c.author}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const busy = loading || creating
  return (
    <PanelContainer>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <div style={{ maxWidth: '920px', margin: '0 auto', padding: '4px 2px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Segmented value={stage} onChange={setStage} disabled={creating}
                options={[['dev-qa', 'develop → qa'], ['qa-prod', 'qa → prod']]} />
              <Segmented value={scope} onChange={setScope} disabled={creating}
                options={[['be', 'BE'], ['fe', 'FE'], ['both', 'BE+FE']]} />
              <span style={{ flex: 1 }} />
              <button onClick={() => setReloadTick(n => n + 1)} disabled={busy} title="reload" data-tip-desc="read branches, commits, work items and active pull requests again"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px',
                  background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-muted)', cursor: busy ? 'not-allowed' : 'pointer'
                }}>
                {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCw size={12} />}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
              <span title="backend repository" data-tip-desc="the Azure DevOps repository of the open repository's connection">
                BE <b style={{ color: 'var(--text-primary)' }}>{beRepo}</b>
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                title="frontend repository" data-tip-desc={`Azure DevOps repository of the frontend in ${project} (saved for this project)`}>
                FE
                <select value={feRepo} onChange={(e) => setFeRepo(e.target.value)} disabled={creating} style={compactInputStyle}>
                  <option value="">—</option>
                  {feRepo && !repos.includes(feRepo) && <option value={feRepo}>{feRepo}</option>}
                  {repos.filter(r => !sameName(r, beRepo)).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <span style={{ color: 'var(--text-muted)' }}>{org} / {project}</span>
            </div>

            {scope !== 'be' && !feRepo && (
              <div style={{ ...noteStyle, background: 'var(--warning-bg)', color: 'var(--warning-color)' }}>
                <AlertTriangle size={11} style={noteIconStyle} />
                scegli la repository FE del project {project}: resta salvata per i prossimi rilasci
              </div>
            )}

            {previews.map(renderCard)}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: 'calc(11px * var(--ui-text-scale, 1))' }}>
                <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> lettura da Azure DevOps...
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                title="auto-complete" data-tip-desc="arm auto-complete: the merge happens when branch policies pass (never bypassed, source branch kept)">
                <input type="checkbox" checked={autoComplete} onChange={(e) => setAutoComplete(e.target.checked)} disabled={creating}
                  style={{ accentColor: 'var(--accent-color)', margin: 0 }} />
                <span style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>auto-complete when policies pass</span>
              </label>
              <span style={{ flex: 1 }} />
              <button onClick={handleCreate} disabled={creatable.length === 0 || busy}
                title="create pull requests" data-tip-desc="create one pull request per repository with new commits and no active promotion PR"
                style={{
                  ...primaryBtnStyle,
                  background: creatable.length > 0 && !busy ? 'var(--accent-color)' : 'var(--bg-disabled)',
                  color: creatable.length > 0 && !busy ? 'var(--text-inverse)' : 'var(--text-muted)',
                  cursor: creatable.length > 0 && !busy ? 'pointer' : 'not-allowed'
                }}>
                {creating ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <GitPullRequest size={11} />}
                crea {creatable.length} PR
              </button>
            </div>
          </div>
        </div>
        <TerminalDock repoPath={null} />
      </div>

      {confirming && (
        <Modal onClose={() => setConfirming(false)} width={480} label="conferma rilascio in produzione">
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: 'calc(12px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--warning-color)', fontSize: 'calc(13px * var(--ui-text-scale, 1))' }}>
              <AlertTriangle size={14} /> rilascio in produzione
            </div>
            <div>Verranno create queste pull request:</div>
            {creatable.map(p => (
              <div key={p.side} style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {p.side} · {p.repo}: {p.source} → {p.target} · {p.commits.length} commit · {selectedItems(p).length} work item
              </div>
            ))}
            <div style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {autoComplete
                ? 'Auto-complete armato: il merge parte quando le branch policy sono soddisfatte.'
                : 'Le PR restano aperte: approvazione e completamento seguono le branch policy.'}
              {' '}Nessuna policy viene bypassata e {roles.from} non viene cancellato.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button onClick={() => setConfirming(false)} style={secondaryBtnStyle}>annulla</button>
              <button onClick={() => void create()}
                style={{ ...primaryBtnStyle, background: 'var(--warning-color)', color: 'var(--text-inverse)', cursor: 'pointer' }}>
                crea {creatable.length} PR
              </button>
            </div>
          </div>
        </Modal>
      )}
    </PanelContainer>
  )
}

function Segmented<T extends string>({ value, options, onChange, disabled }: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      {options.map(([v, label]) => {
        const active = v === value
        return (
          <button key={v} onClick={() => onChange(v)} disabled={disabled}
            style={{
              padding: '4px 10px', border: 'none',
              background: active ? 'var(--accent-bg)' : 'var(--bg-card)',
              color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
              cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: active ? 600 : 400,
              fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
            }}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

const compactInputStyle: React.CSSProperties = {
  padding: '2px 6px', background: 'var(--bg-input)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none',
  fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
}

const tagStyle: React.CSSProperties = {
  padding: '1px 6px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
  background: 'var(--bg-tag)', color: 'var(--accent-color)',
  fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-mono)'
}

const badgeBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '3px', padding: '2px 8px', border: 'none',
  borderRadius: 'var(--radius-sm)', cursor: 'pointer',
  fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-mono)'
}

const noteStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '6px 10px',
  borderRadius: 'var(--radius-sm)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', lineHeight: 1.5
}

const noteIconStyle: React.CSSProperties = { flexShrink: 0, marginTop: 2 }

const secondaryBtnStyle: React.CSSProperties = {
  padding: '7px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer',
  fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
}

const primaryBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 16px',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 'calc(12px * var(--ui-text-scale, 1))',
  fontFamily: 'var(--font-mono)', fontWeight: 600
}
