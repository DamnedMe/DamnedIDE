import { useEffect, useRef, useState } from 'react'
import { Rocket, Loader2, RotateCw, ChevronRight, ChevronDown, GitPullRequest, AlertTriangle, CheckCircle2, XCircle, Clock, Ban, Trash2, Link2 } from '@/components/icons'
import { PanelContainer } from '../layout/PanelContainer'
import { Modal } from '../layout/Modal'
import { TerminalDock } from '../terminal/TerminalDock'
import { AdoRepoChooser, useConnectionRepos } from './AdoRepoChooser'
import { useAdoStore, useAdoSettingsStore, useSettingsNavStore, useToastStore } from '../../store'
import { useAdoFolder } from '../../hooks/useAdoFolder'
import type { AdoPullRequest, AdoWorkItem } from '../../types/ado'
import {
  STAGE_ROLES,
  RELEASE_STAGE_LABELS,
  resolveEnvBranch,
  extractWorkItemIds,
  promotionTitle,
  promotionDescription,
  promotionConfigKey,
  firstLine,
  type EnvRole,
  type PromotionConfig,
  type ReleaseStage,
  type PromotionScope
} from '../../shared/adoPromotion'
import { ADO_MISSING_PAT, releaseRepos, sameName, siblingRepos, withBeRepo } from '../../shared/adoSettings'
import { activeChainItem, chainProjectKey, isChainActive } from '../../shared/adoChain'
import type { ChainItem, ChainStartItem, ChainStatus, ReleaseChain } from '../../shared/adoChain'
import { ipcMessage } from '../settings/ui'

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
  /** develop → qa → prod only: the prod branch */
  prod?: string | null
  /** develop → qa → prod only, when develop → qa has nothing: commits qa → prod (the chain starts there) */
  prodCommits?: number
  /** develop → qa → prod only, when develop → qa has nothing: the qa → prod PR already open */
  prodExisting?: AdoPullRequest | null
  warning?: string
  error?: string
  status?: 'running' | 'ok' | 'error'
  /** notArmed: auto-complete was asked for and Azure DevOps did not take it (the PR stays open) */
  created?: { id: number; url: string; mode: 'autocomplete' | 'completed' | 'open'; notArmed?: boolean }
}

type ReadyPreview = RepoPreview & { source: string; target: string }
type ChainPreview = ReadyPreview & { prod: string }

/**
 * Release promotion: one pull request per repository (BE and FE = two
 * repositories of the open folder's Azure DevOps connection, chosen here and
 * saved per org/project in Settings › Azure DevOps › Rilascio) from develop
 * to qa or from qa to prod, with the work items found in the commits linked.
 * The third stage chains both: the develop → qa PRs are created here, then the
 * main process (promotion-chain.service.ts) creates each qa → prod PR as soon as
 * its develop → qa PR is completed and follows it until it is completed too; the
 * chains of the project are listed below.
 */
export function PromotionPanel({ repoPath }: { repoPath: string | null }) {
  const setPullRequests = useAdoStore(s => s.setPullRequests)
  const settings = useAdoSettingsStore(s => s.settings)
  const showToast = useToastStore(s => s.showToast)

  const ado = useAdoFolder(repoPath)
  const connection = ado.status === 'ready' ? ado.connection : null
  const connectionId = connection?.id ?? null
  const org = connection?.organization ?? ''
  const project = connection?.project ?? ''
  // the open folder's own repository: the default BE
  const folderRepo = ado.repository ?? ''
  const configKey = connection ? promotionConfigKey(org, project) : ''
  // a choice being saved shows at once; the settings reload follows
  const [draft, setDraft] = useState<{ key: string; config: PromotionConfig } | null>(null)
  const config: PromotionConfig = (draft && draft.key === configKey ? draft.config : settings?.release[configKey]) ?? {}
  // FE default: a repository mapped to another folder of the same connection
  const siblings = connectionId && settings ? siblingRepos(settings.folders, connectionId, ado.folderKey) : []
  const { be: beRepo, fe: feRepo } = releaseRepos(config, folderRepo || null, siblings)
  // BE / FE pickers: the repositories of the folder's connection
  const repoList = useConnectionRepos(connectionId)
  const repos = repoList?.ok ? repoList.repos : []

  // the stage is part of the release config: remembered per project, editable in Settings › Rilascio
  const stage: ReleaseStage = config.stage ?? 'dev-qa'
  const chainMode = stage === 'dev-qa-prod'

  // every hook stays above the early return (no ErrorBoundary: a hook-order bug blanks the app)
  const [scope, setScope] = useState<PromotionScope>('be')
  const [previews, setPreviews] = useState<RepoPreview[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  // unticked work items, as `${side}:${id}`
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [openCommits, setOpenCommits] = useState<Set<Side>>(() => new Set())
  const [autoComplete, setAutoComplete] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [creating, setCreating] = useState(false)
  // release chains of every project (main keeps them); this panel shows the open project's
  const [chains, setChains] = useState<ReleaseChain[]>([])

  useEffect(() => {
    const api = window.electronAPI?.adoChain
    if (!api) return
    let alive = true
    const load = () => { api.list().then(list => { if (alive) setChains(list) }).catch(() => {}) }
    load()
    const off = api.onChanged(load)
    // another instance may poll the chains: read them again when the window gets the focus back
    window.addEventListener('focus', load)
    return () => {
      alive = false
      off()
      window.removeEventListener('focus', load)
    }
  }, [])

  // the chain previews develop → qa (its first step) and resolves prod too
  const roles = STAGE_ROLES[stage === 'qa-prod' ? 'qa-prod' : 'dev-qa']
  const targets: { side: Side; repo: string }[] = []
  if (scope !== 'fe' && beRepo) targets.push({ side: 'BE', repo: beRepo })
  if (scope !== 'be' && feRepo) targets.push({ side: 'FE', repo: feRepo })
  const targetsKey = targets.map(t => `${t.side}=${t.repo}`).join('|')
  const overridesKey = JSON.stringify(config.branches ?? {})

  const loadPreview = async (side: Side, repo: string): Promise<RepoPreview> => {
    const api = window.electronAPI.ado
    const base: RepoPreview = { side, repo, branches: [], source: null, target: null, commits: [], workItems: [], existing: null }
    try {
      const branches = await api.branches(project, repo)
      if (branches.length === 0) return { ...base, error: `nessun branch letto da ${repo}: controlla repository e PAT` }
      const overrides = config.branches?.[repo] ?? {}
      const source = resolveEnvBranch(roles.from, branches, overrides[roles.from])
      const target = resolveEnvBranch(roles.to, branches, overrides[roles.to])
      const prod = chainMode ? resolveEnvBranch('prod', branches, overrides.prod) : null
      if (!source || !target || (chainMode && !prod)) return { ...base, branches, source, target, prod }
      // chain: strict reads, a failed one must not look like "nothing to promote" (that item
      // would skip develop → qa and get its qa → prod PR at once)
      const commits = await api.commitsBetween(project, repo, source, target, chainMode)
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
      const prs = await api.pullRequests(project, repo)
      const existing = prs.find(p => sameName(p.sourceBranch, source) && sameName(p.targetBranch, target)) ?? null
      // chain with nothing to promote to qa: it starts at qa → prod, worth it only with commits
      // there and no qa → prod PR already open (a chain cancelled while waiting for it leaves it open)
      const startsAtProd = chainMode && !!prod && commits.length === 0 && !existing
      const prodExisting = startsAtProd
        ? prs.find(p => sameName(p.sourceBranch, target) && sameName(p.targetBranch, prod)) ?? null
        : null
      const prodCommits = startsAtProd && !prodExisting
        ? (await api.commitsBetween(project, repo, target, prod, true)).length
        : undefined
      return { ...base, branches, source, target, prod, commits, workItems, existing, warning, prodCommits, prodExisting }
    } catch (e) {
      return { ...base, error: ipcMessage(e, 'lettura da Azure DevOps fallita') }
    }
  }

  useEffect(() => {
    setPreviews([])
    setExcluded(new Set())
    const id = connectionId
    const active = !!id && targets.length > 0
    setLoading(active)
    if (!id || !active) return
    let cancelled = false
    ;(async () => {
      const out: RepoPreview[] = []
      try {
        if (!(await window.electronAPI.ado.use(id))) throw new Error(ADO_MISSING_PAT)
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
  }, [connectionId, project, stage, targetsKey, overridesKey, reloadTick])

  /** Every release choice is saved at once, per org/project (Settings › Azure DevOps › Rilascio). */
  const saveRelease = async (next: PromotionConfig) => {
    if (!configKey) return
    const key = configKey
    setDraft({ key, config: next })
    try {
      await window.electronAPI.adoSettings.setRelease(key, next)
      await useAdoSettingsStore.getState().load()
    } catch (e) {
      showToast(`scelta di rilascio non salvata: ${ipcMessage(e, 'salvataggio fallito')}`, 'error')
    } finally {
      setDraft(d => (d && d.config === next ? null : d))
    }
  }

  const setBranchOverride = (repo: string, role: EnvRole, branch: string) => {
    void saveRelease({ ...config, branches: { ...config.branches, [repo]: { ...config.branches?.[repo], [role]: branch } } })
  }

  // same rule as Settings › Rilascio: a saved FE that becomes the BE goes back to automatic
  const setBeRepo = (repo: string) => { void saveRelease(withBeRepo(config, repo)) }
  const setFeRepo = (repo: string) => { void saveRelease({ ...config, feRepo: repo }) }
  const setStage = (next: ReleaseStage) => { if (next !== stage) void saveRelease({ ...config, stage: next }) }

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

  const creatable = chainMode ? [] : previews.filter((p): p is ReadyPreview =>
    !!p.source && !!p.target && !p.error && p.commits.length > 0 && !p.existing && !p.created)

  // project chains, newest first; a repository is in one running chain at a time
  const projectChains = chains
    .filter(c => chainProjectKey(c.organization, c.project) === configKey)
    .sort((a, b) => b.createdAt - a.createdAt)
  const runningChain = (repo: string) => activeChainItem(chains, org, project, repo)

  // a chain step that creates the qa → prod PR or settles (done, failed, cancelled) changes
  // what the previews offer (a qa → prod PR now active, commits already on qa): read them again.
  // Steps left: pre-prod 2, waiting-prod 1, finished 0, so every forward step lowers the sum
  // and starting a chain does not (its created / notArmed badges stay)
  const stepsLeft = projectChains.reduce((n, c) => n + c.items.reduce((m, i) =>
    m + (i.status === 'waiting-qa' || i.status === 'creating-prod' ? 2 : i.status === 'waiting-prod' ? 1 : 0), 0), 0)
  const prevStepsLeft = useRef(stepsLeft)
  useEffect(() => {
    if (stepsLeft < prevStepsLeft.current) setReloadTick(t => t + 1)
    prevStepsLeft.current = stepsLeft
  }, [stepsLeft])

  // the chain also takes a repository whose develop → qa PR is already active (followed) or
  // that has nothing for qa but commits for prod (it starts at step 2)
  const chainable = !chainMode ? [] : previews.filter((p): p is ChainPreview =>
    !!p.source && !!p.target && !!p.prod && !p.error && !p.created && !runningChain(p.repo) &&
    (p.commits.length > 0 || !!p.existing || (p.prodCommits ?? 0) > 0))
  const actionable = chainMode ? chainable.length : creatable.length

  /** The develop → qa (or qa → prod) PR of one preview, with the ticked work items; null when Azure DevOps refuses it. */
  const createPromotionPr = (p: ReadyPreview) => {
    const items = selectedItems(p)
    return window.electronAPI.ado.createPr(project, p.repo, {
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
  }

  // the DevOps panel lists the open folder's repository: refresh it when it got a PR
  const refreshFolderPrs = (repos: string[]) => {
    if (!folderRepo || !repos.some(r => sameName(r, folderRepo))) return
    window.electronAPI.ado.pullRequests(project, folderRepo).then(setPullRequests).catch(() => {})
  }

  const create = async () => {
    setConfirming(false)
    if (creating || creatable.length === 0) return
    setCreating(true)
    const api = window.electronAPI.ado
    const done: string[] = []
    const failed: string[] = []
    try {
      if (!connectionId || !(await api.use(connectionId))) throw new Error(ADO_MISSING_PAT)
      for (const p of creatable) {
        patchPreview(p.side, { status: 'running' })
        const res = await createPromotionPr(p)
        if (res) {
          done.push(`${p.side} #${res.id}`)
          patchPreview(p.side, { status: 'ok', created: { id: res.id, url: res.url, mode: res.mode, notArmed: autoComplete && res.mode === 'open' } })
        } else {
          failed.push(p.side)
          patchPreview(p.side, { status: 'error' })
        }
      }
      refreshFolderPrs(creatable.map(p => p.repo))
    } catch (e) {
      showToast((e as Error).message || 'Azure DevOps non raggiungibile', 'error')
    } finally {
      setCreating(false)
    }
    if (failed.length === 0 && done.length > 0) showToast(`PR di rilascio create: ${done.join(', ')}`)
    else if (failed.length > 0) showToast(`PR create: ${done.join(', ') || 'nessuna'} · fallite: ${failed.join(', ')}`, 'error')
  }

  /**
   * develop → qa → prod: step 1 here (new develop → qa PRs; an active one is
   * followed; nothing for qa goes straight to step 2), then main follows each
   * develop → qa PR and creates qa → prod when it is completed.
   */
  const startChain = async () => {
    setConfirming(false)
    if (creating || chainable.length === 0 || !connectionId) return
    setCreating(true)
    const items: ChainStartItem[] = []
    const failed: string[] = []
    let started = false
    try {
      if (!(await window.electronAPI.ado.use(connectionId))) throw new Error(ADO_MISSING_PAT)
      for (const p of chainable) {
        const branches = { dev: p.source, qa: p.target, prod: p.prod }
        if (p.existing) {
          items.push({ side: p.side, repo: p.repo, branches, qaPr: { id: p.existing.id, url: prWebUrl(p.repo, p.existing) } })
          continue
        }
        if (p.commits.length === 0) {
          items.push({ side: p.side, repo: p.repo, branches })
          continue
        }
        patchPreview(p.side, { status: 'running' })
        const res = await createPromotionPr(p)
        if (!res) {
          failed.push(p.side)
          patchPreview(p.side, { status: 'error' })
          continue
        }
        patchPreview(p.side, { status: 'ok', created: { id: res.id, url: res.url, mode: res.mode, notArmed: autoComplete && res.mode === 'open' } })
        items.push({
          side: p.side, repo: p.repo, branches, qaPr: { id: res.id, url: res.url },
          // asked for, not taken by Azure DevOps: the chain card says so while it waits
          ...(autoComplete && res.mode !== 'autocomplete' ? { qaNoAutoComplete: true } : {})
        })
      }
      refreshFolderPrs(items.map(i => i.repo))
      if (items.length > 0) {
        try {
          await window.electronAPI.adoChain.start({ connectionId, autoComplete, items })
          started = true
        } catch (e) {
          const kept = items.filter(i => i.qaPr).map(i => `${i.side} #${i.qaPr!.id}`)
          throw new Error(`catena non avviata: ${ipcMessage(e, 'errore')}${kept.length > 0 ? ` (le PR ${kept.join(', ')} restano aperte)` : ''}`)
        }
        window.electronAPI.adoChain.list().then(setChains).catch(() => {})
      }
    } catch (e) {
      showToast((e as Error).message || 'Azure DevOps non raggiungibile', 'error')
    } finally {
      setCreating(false)
    }
    const names = items.map(i => `${i.side} ${i.repo}`).join(', ')
    if (started && failed.length === 0) showToast(`catena di rilascio avviata: ${names}`)
    else if (started) showToast(`catena avviata per ${names} · PR develop → qa fallite: ${failed.join(', ')}`, 'error')
    else if (failed.length > 0 && items.length === 0) showToast(`catena non avviata: PR develop → qa fallite (${failed.join(', ')})`, 'error')
  }

  const chainAction = async (run: () => Promise<void>, fallback: string) => {
    try {
      await run()
      setChains(await window.electronAPI.adoChain.list())
    } catch (e) {
      showToast(ipcMessage(e, fallback), 'error')
    }
  }

  // develop → qa goes at once; qa → prod and the chain (which covers qa → prod) are confirmed first
  const handleCreate = () => {
    if (stage === 'dev-qa') void create()
    else setConfirming(true)
  }

  if (!repoPath || !connection) {
    return (
      <PanelContainer>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {repoPath ? (
            // no connection, or the folder's repository is not clear: say so and let the user choose
            <AdoRepoChooser state={ado} />
          ) : (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '12px', color: 'var(--text-secondary)', fontSize: 'calc(13px * var(--ui-text-scale, 1))', textAlign: 'center'
            }}>
              <Rocket size={32} strokeWidth={1} />
              apri un repository: il rilascio usa la sua connessione Azure DevOps
            </div>
          )}
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
        title={value ? `${role} branch: ${value}` : `${role} branch`} data-tip-desc={`branch used as ${role} in ${p.repo} (saved for this repository)`}
        style={{
          ...compactInputStyle,
          // a native select is as wide as its longest option (long feature branches pushed the three
          // pickers onto separate rows): sized on the chosen branch instead, in ch of the mono font
          // (+4ch for padding and arrow, at most 32ch); the open list still shows every full name
          width: `${Math.min((value ?? `${role}?`).length, 32) + 4}ch`, textOverflow: 'ellipsis',
          borderColor: value ? 'var(--border-color)' : 'var(--warning-color)',
          color: value ? 'var(--text-primary)' : 'var(--warning-color)'
        }}>
        {!value && <option value="">{role}?</option>}
        {p.branches.map(b => <option key={b} value={b}>{b}</option>)}
      </select>
    )
  )

  const renderCard = (p: RepoPreview) => {
    const branchesFound = !!p.source && !!p.target && (!chainMode || !!p.prod)
    const ready = branchesFound && !p.error
    const locked = !!p.existing || !!p.created || creating
    const commitsOpen = openCommits.has(p.side)
    const missingRole = !p.source ? roles.from : !p.target ? roles.to : 'prod'
    const running = chainMode ? runningChain(p.repo) : null
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
          {chainMode && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>→</span>
              {branchPicker(p, 'prod', p.prod ?? null)}
            </>
          )}
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
          {p.created && (() => {
            // auto-complete asked for but not taken by Azure DevOps: say so, the PR stays open
            const { notArmed } = p.created
            return (
              <button onClick={() => openUrl(p.created!.url)} title="open in Azure DevOps"
                data-tip-desc={notArmed ? 'Azure DevOps did not take the auto-complete: set it on the pull request' : 'the pull request just created'}
                style={{ ...badgeBtnStyle, background: notArmed ? 'var(--warning-bg)' : 'var(--success-bg)', color: notArmed ? 'var(--warning-color)' : 'var(--success-color)' }}>
                {notArmed ? <AlertTriangle size={10} /> : <CheckCircle2 size={10} />} PR #{p.created.id} {p.created.mode === 'autocomplete' ? 'creata (auto-complete)' : notArmed ? 'creata, auto-complete non armato' : 'creata'} ↗
              </button>
            )
          })()}
        </div>

        {p.error && <div style={{ ...noteStyle, background: 'var(--error-bg)', color: 'var(--error-color)' }}><XCircle size={11} style={noteIconStyle} />{p.error}</div>}
        {!p.error && !branchesFound && (
          <div style={{ ...noteStyle, background: 'var(--warning-bg)', color: 'var(--warning-color)' }}>
            <AlertTriangle size={11} style={noteIconStyle} />
            branch {missingRole} non trovato in {p.repo}: sceglilo dall'elenco (resta salvato per questa repository)
          </div>
        )}
        {running && (
          <div style={{ ...noteStyle, background: 'var(--accent-bg)', color: 'var(--accent-color)' }}>
            <Link2 size={11} style={noteIconStyle} />
            catena di rilascio già in corso per {p.repo}: l'avanzamento è in «catene in corso», qui sotto
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
            {!chainMode
              ? `nulla da promuovere: ${p.target} contiene già tutti i commit di ${p.source}`
              : p.prodExisting
                ? `${p.source} → ${p.target}: nulla da promuovere; PR #${p.prodExisting.id} ${p.target} → ${p.prod} già aperta`
                : (p.prodCommits ?? 0) > 0
                  ? `${p.source} → ${p.target}: nulla da promuovere, la catena parte da ${p.target} → ${p.prod} (${p.prodCommits} commit)`
                  : `nulla da promuovere: ${p.target} e ${p.prod} contengono già tutti i commit`}
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

  const renderChainItem = (chain: ReleaseChain, item: ChainItem) => {
    const { dev, qa, prod } = item.branches
    const chip = CHAIN_STATUS[item.status]
    const prLink = (pr: { id: number; url: string }, what: string) => (
      <button
        onClick={() => openUrl(pr.url || `https://dev.azure.com/${encodeURIComponent(chain.organization)}/${encodeURIComponent(chain.project)}/_git/${encodeURIComponent(item.repo)}/pullrequest/${pr.id}`)}
        title="open in Azure DevOps" data-tip-desc={what}
        style={{ ...badgeBtnStyle, background: 'var(--bg-tag)', color: 'var(--accent-color)' }}>
        PR #{pr.id} ↗
      </button>
    )
    const qaWaiting = item.status === 'waiting-qa'
    const prodWaiting = item.status === 'waiting-prod'
    // auto-complete asked for and not taken by Azure DevOps: the PR waits for someone to set it
    const notArmed = 'auto-complete non armato: impostalo da Azure DevOps'
    const warn1 = qaWaiting && !!item.qaNoAutoComplete
    const warn2 = prodWaiting && !item.prodReused && !!item.prodNoAutoComplete
    const step1 = !item.qaPr
      ? 'nulla da promuovere'
      : qaWaiting ? `in attesa del completamento${warn1 ? ` · ${notArmed}` : ''}`
        // a qa → prod PR only exists once develop → qa is completed
        : item.status === 'creating-prod' || prodWaiting || item.status === 'done' || item.prodPr ? 'completata' : ''
    const step2 = item.prodPr
      ? prodWaiting
        ? item.prodReused ? 'già attiva: seguita dalla catena, in attesa del completamento'
          : `in attesa del completamento${warn2 ? ` · ${notArmed}` : ''}`
        : item.prodDone ? 'completata'
          // no longer followed: failed = the qa → prod PR was abandoned; cancelled = it stays as it is in Azure DevOps
          : item.status === 'failed' ? 'abbandonata' : item.prodReused ? 'già attiva' : 'creata'
      : qaWaiting ? `partirà quando la PR ${dev} → ${qa} è completata`
        : item.status === 'creating-prod' ? 'creazione in corso…'
          : item.status === 'cancelled' ? 'non creata: catena annullata'
            : item.status === 'failed' ? 'non creata' : item.note ?? ''
    const waiting = <Clock size={10} style={{ flexShrink: 0 }} />
    return (
      <div key={item.side} style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '6px', borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: 'calc(11px * var(--ui-text-scale, 1))' }}>
          <span style={tagStyle}>{item.side}</span>
          <b style={{ color: 'var(--text-primary)' }}>{item.repo}</b>
          <span style={{ ...badgeBtnStyle, cursor: 'default', background: chip.bg, color: chip.color }}>{chip.label}</span>
        </div>
        <div style={stepRowStyle}>
          <span style={{ color: 'var(--text-muted)' }}>1. {dev} → {qa}</span>
          {item.qaPr && prLink(item.qaPr, `the ${dev} → ${qa} pull request followed by the chain`)}
          {qaWaiting && waiting}
          <span style={warn1 ? { color: 'var(--warning-color)' } : undefined}>{step1}</span>
        </div>
        <div style={stepRowStyle}>
          <span style={{ color: 'var(--text-muted)' }}>2. {qa} → {prod}</span>
          {item.prodPr && prLink(item.prodPr, `the ${qa} → ${prod} pull request followed by the chain`)}
          {(qaWaiting || prodWaiting) && waiting}
          {item.status === 'creating-prod' && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
          <span style={warn2 ? { color: 'var(--warning-color)' } : undefined}>{step2}</span>
        </div>
        {item.error && (
          <div style={{ ...noteStyle, background: 'var(--error-bg)', color: 'var(--error-color)' }}>
            <XCircle size={11} style={noteIconStyle} />{item.error}
          </div>
        )}
        {item.lastError && (
          <div style={{ ...noteStyle, background: 'var(--warning-bg)', color: 'var(--warning-color)' }}>
            <AlertTriangle size={11} style={noteIconStyle} />
            ultimo controllo non riuscito: {item.lastError} · nuovo tentativo ogni 30 s
          </div>
        )}
      </div>
    )
  }

  const renderChain = (chain: ReleaseChain) => {
    const active = isChainActive(chain)
    return (
      <div key={chain.id} role="group" aria-label={`catena ${chain.items.map(i => i.repo).join(', ')}`} style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
        padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: '6px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          <span>avviata {new Date(chain.createdAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>
          <span>· {chain.autoComplete ? 'auto-complete sulle PR nuove' : 'PR lasciate aperte'}</span>
          <span style={{ flex: 1 }} />
          {active ? (
            <button onClick={() => void chainAction(() => window.electronAPI.adoChain.cancel(chain.id), 'annullamento fallito')}
              title="annulla catena" data-tip-desc="stop the chain: no qa → prod pull request is created or followed any more (the pull requests already created stay in Azure DevOps)"
              style={smallBtnStyle}>
              <Ban size={10} /> annulla catena
            </button>
          ) : (
            <button onClick={() => void chainAction(() => window.electronAPI.adoChain.remove(chain.id), 'rimozione fallita')}
              title="rimuovi" data-tip-desc="remove this finished chain from the list (nothing changes in Azure DevOps)"
              style={smallBtnStyle}>
              <Trash2 size={10} /> rimuovi
            </button>
          )}
        </div>
        {chain.items.map(item => renderChainItem(chain, item))}
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
                options={Object.entries(RELEASE_STAGE_LABELS) as [ReleaseStage, string][]} />
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
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                title="repository BE" data-tip-desc={`repository Azure DevOps del backend in ${project} (di default quella della cartella aperta; resta salvata per questo project)`}>
                BE
                <select aria-label="repository BE" value={beRepo} onChange={(e) => setBeRepo(e.target.value)} disabled={creating} style={compactInputStyle}>
                  {!beRepo && <option value="">—</option>}
                  {beRepo && !repos.includes(beRepo) && <option value={beRepo}>{beRepo}</option>}
                  {repos.map(r => <option key={r} value={r}>{r}{folderRepo && sameName(r, folderRepo) ? ' (questa cartella)' : ''}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                title="repository FE" data-tip-desc={`repository Azure DevOps del frontend in ${project} (resta salvata per questo project)`}>
                FE
                <select aria-label="repository FE" value={feRepo} onChange={(e) => setFeRepo(e.target.value)} disabled={creating} style={compactInputStyle}>
                  <option value="">—</option>
                  {feRepo && !repos.includes(feRepo) && <option value={feRepo}>{feRepo}</option>}
                  {repos.filter(r => !sameName(r, beRepo)).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <span style={{ color: 'var(--text-muted)' }}>{org} / {project}</span>
              <span style={{ flex: 1 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))' }}>
                salvato nelle{' '}
                <button onClick={() => useSettingsNavStore.getState().openSettings('ado-release')}
                  title="Impostazioni › Azure DevOps › Rilascio" data-tip-desc="apri le impostazioni di rilascio: repository BE e FE per ogni connessione"
                  style={linkBtnStyle}>
                  Impostazioni › Azure DevOps › Rilascio
                </button>
              </span>
            </div>

            {repoList && !repoList.ok && (
              <div style={{ ...noteStyle, background: 'var(--warning-bg)', color: 'var(--warning-color)' }}>
                <AlertTriangle size={11} style={noteIconStyle} />
                repository di {org}/{project} non lette ({repoList.error}): BE e FE restano quelle salvate
              </div>
            )}

            {scope !== 'fe' && !beRepo && (
              <div style={{ ...noteStyle, background: 'var(--warning-bg)', color: 'var(--warning-color)' }}>
                <AlertTriangle size={11} style={noteIconStyle} />
                scegli la repository BE del project {project}: resta salvata per i prossimi rilasci
              </div>
            )}

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
              <button onClick={handleCreate} disabled={actionable === 0 || busy}
                title={chainMode ? 'start the release chain' : 'create pull requests'}
                data-tip-desc={chainMode
                  ? 'create the develop → qa pull requests now; each qa → prod one is created as soon as its develop → qa PR is completed'
                  : 'create one pull request per repository with new commits and no active promotion PR'}
                style={{
                  ...primaryBtnStyle,
                  background: actionable > 0 && !busy ? 'var(--accent-color)' : 'var(--bg-disabled)',
                  color: actionable > 0 && !busy ? 'var(--text-inverse)' : 'var(--text-muted)',
                  cursor: actionable > 0 && !busy ? 'pointer' : 'not-allowed'
                }}>
                {creating ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : chainMode ? <Link2 size={11} /> : <GitPullRequest size={11} />}
                {chainMode ? `avvia catena (${chainable.length})` : `crea ${creatable.length} PR`}
              </button>
            </div>

            {projectChains.length > 0 && (
              <section aria-label="catene in corso" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                <div style={sectionTitleStyle}>
                  <Link2 size={11} /> catene in corso
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                    · seguite da DamnedIDE ogni 30 s, anche dopo un riavvio
                  </span>
                </div>
                {projectChains.map(renderChain)}
              </section>
            )}
          </div>
        </div>
        <TerminalDock repoPath={null} />
      </div>

      {confirming && chainMode && (
        <Modal onClose={() => setConfirming(false)} width={560} label="conferma catena di rilascio develop → qa → prod">
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: 'calc(12px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--warning-color)', fontSize: 'calc(13px * var(--ui-text-scale, 1))' }}>
              <AlertTriangle size={14} /> rilascio develop → qa → prod
            </div>
            <div style={{ lineHeight: 1.5 }}>
              Questa conferma vale anche per la produzione: ogni PR qa → prod viene creata da sola appena
              la PR develop → qa della stessa repository è completata.
            </div>
            {chainable.map(p => (
              <div key={p.side} style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontFamily: 'var(--font-mono)', fontSize: 'calc(11px * var(--ui-text-scale, 1))' }}>
                <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{p.side} · {p.repo}</div>
                <div>
                  1. {p.source} → {p.target}:{' '}
                  {p.existing
                    ? `PR #${p.existing.id} già attiva, la catena la segue (auto-complete non modificato)`
                    : p.commits.length > 0
                      ? `nuova PR · ${p.commits.length} commit · ${selectedItems(p).length} work item`
                      : 'nulla da promuovere, si parte dal passo 2'}
                </div>
                <div>
                  2. {p.target} → {p.prod}:{' '}
                  {!p.existing && p.commits.length === 0
                    ? `PR creata subito · ${p.prodCommits ?? 0} commit`
                    : `PR creata appena la PR ${p.source} → ${p.target} è completata`}
                  {' · con tutti i work item dei suoi commit'}
                </div>
              </div>
            ))}
            <div style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {autoComplete
                ? "Auto-complete armato sulle PR create dalla catena (una PR già attiva viene seguita o riusata così com'è): ogni merge parte quando le branch policy sono soddisfatte."
                : 'Le PR restano aperte: approvazione e completamento seguono le branch policy (la catena aspetta il completamento).'}
              {' '}Nessuna policy viene bypassata e i branch develop e qa non vengono cancellati.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button onClick={() => setConfirming(false)} style={secondaryBtnStyle}>annulla</button>
              <button onClick={() => void startChain()}
                style={{ ...primaryBtnStyle, background: 'var(--warning-color)', color: 'var(--text-inverse)', cursor: 'pointer' }}>
                avvia catena
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirming && !chainMode && (
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
          <button key={v} onClick={() => onChange(v)} disabled={disabled} aria-pressed={active}
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

const linkBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
  color: 'var(--accent-color)', fontSize: 'inherit', fontFamily: 'inherit'
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

const sectionTitleStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', color: 'var(--text-muted)',
  fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.6px'
}

const stepRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', paddingLeft: '2px',
  fontSize: 'calc(10.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)'
}

const smallBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', background: 'var(--bg-card)',
  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
  cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
}

const CHAIN_STATUS: Record<ChainStatus, { label: string; bg: string; color: string }> = {
  'waiting-qa': { label: 'in attesa di qa', bg: 'var(--accent-bg)', color: 'var(--accent-color)' },
  'creating-prod': { label: 'creazione PR prod', bg: 'var(--accent-bg)', color: 'var(--accent-color)' },
  'waiting-prod': { label: 'in attesa di prod', bg: 'var(--accent-bg)', color: 'var(--accent-color)' },
  done: { label: 'completata', bg: 'var(--success-bg)', color: 'var(--success-color)' },
  failed: { label: 'interrotta', bg: 'var(--error-bg)', color: 'var(--error-color)' },
  cancelled: { label: 'annullata', bg: 'var(--bg-tag)', color: 'var(--text-muted)' }
}

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
