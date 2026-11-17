// The desktop Release panel (src/components/ado/PromotionPanel.tsx) for the DamnedCloud bridge:
// the same reads, the same pull requests and the same chains, run in main. The folder's Azure
// DevOps repository resolves as in useAdoFolder (saved mapping, else the only same-name
// repository); the release choices are the ones the desktop saves per project. Every call gets
// its own AdoService: the panels' singleton follows the last connection the desktop picked.
// ponytail: readPreview mirrors PromotionPanel.loadPreview (renderer, i18n); a fix there belongs here too
// No electron import: main wires the store, the catalog, the chains and git.
import { AdoService } from './ado.service'
import type { AdoSettingsStore } from './ado-settings.store'
import type { PromotionChainService } from './promotion-chain.service'
import {
  STAGE_ROLES, extractWorkItemIds, promotionConfigKey, promotionDescription, promotionTitle, resolveEnvBranch
} from '../../../src/shared/adoPromotion'
import type { EnvRole, PromotionConfig } from '../../../src/shared/adoPromotion'
import {
  ADO_MISSING_PAT, folderKey, folderName, mainFolderPath, releaseRepos, resolveFolderRepo, sameName, siblingRepos, withBeRepo
} from '../../../src/shared/adoSettings'
import type { AdoConnectionConfig, AdoRepoList } from '../../../src/shared/adoSettings'
import { activeChainItem, chainProjectKey } from '../../../src/shared/adoChain'
import type { ChainStartItem, ReleaseChain } from '../../../src/shared/adoChain'
import type {
  ReleaseChainView, ReleaseCreated, ReleasePr, ReleaseRepoPreview, ReleaseRole, ReleaseScope, ReleaseSide,
  ReleaseStage, ReleaseState
} from '../../../src/shared/remote/protocol'

/** What the release needs from Azure DevOps (a fake in scripts/release-remote.check.ts). */
export type ReleaseAdo = Pick<AdoService,
  'use' | 'getBranches' | 'getCommitsBetween' | 'getWorkItemsBatch' | 'getPullRequests' | 'createPullRequest'>

export interface ReleaseDeps {
  settings: Pick<AdoSettingsStore, 'read' | 'token' | 'setRelease'>
  /** repositories of a connection (main caches them) */
  repositories: (connection: AdoConnectionConfig) => Promise<AdoRepoList>
  chains: Pick<PromotionChainService, 'list' | 'start' | 'cancel' | 'remove'>
  /** `git rev-parse --git-common-dir`: a linked worktree resolves to its main folder */
  gitCommonDir: (repoPath: string) => Promise<string>
  createAdo?: () => ReleaseAdo
  /** release settings saved here: the desktop panel and the phones read them again */
  changed?: () => void
}

interface Context {
  connection: AdoConnectionConfig
  folderRepo: string
  configKey: string
  config: PromotionConfig
  be: string
  fe: string
}

/** release.create / release.chainStart read again, then (qa → prod, the chain) confirmed by the phone. */
export interface ReleasePlan {
  ctx: Context
  ado: ReleaseAdo
  /** repositories with something to do, in BE, FE order */
  items: ReleaseRepoPreview[]
  autoComplete: boolean
  excluded: Set<string>
  /** set when the phone must confirm first */
  confirm?: { summary: string; details: string }
}

const STAGES: ReadonlySet<unknown> = new Set<ReleaseStage>(['dev-qa', 'qa-prod', 'dev-qa-prod'])
const SCOPES: ReadonlySet<unknown> = new Set<ReleaseScope>(['be', 'fe', 'both'])
const ROLES: ReadonlySet<unknown> = new Set<ReleaseRole>(['dev', 'qa', 'prod'])

const commitCount = (n: number) => `${n} commit`
const itemCount = (n: number) => `${n} work item`

/** fetch's "fetch failed" hides the reason in `cause`. */
function errorText(e: unknown): string {
  const err = e as Error & { cause?: { message?: string } }
  return err?.cause?.message || err?.message || ''
}

function stageOf(v: unknown): ReleaseStage {
  if (!STAGES.has(v)) throw new Error(`fase di rilascio non valida: ${String(v)}`)
  return v as ReleaseStage
}

function scopeOf(v: unknown): ReleaseScope {
  if (!SCOPES.has(v)) throw new Error(`ambito di rilascio non valido: ${String(v)}`)
  return v as ReleaseScope
}

export class ReleaseService {
  private deps: ReleaseDeps

  constructor(deps: ReleaseDeps) {
    this.deps = deps
  }

  async state(repoPath: string): Promise<ReleaseState> {
    const ctx = await this.context(repoPath)
    if (typeof ctx === 'string') {
      return { unavailable: ctx, organization: '', project: '', folderRepo: '', be: '', fe: '', stage: 'dev-qa', repos: [], chains: [] }
    }
    const list = await this.deps.repositories(ctx.connection)
    return {
      organization: ctx.connection.organization,
      project: ctx.connection.project,
      folderRepo: ctx.folderRepo,
      be: ctx.be,
      fe: ctx.fe,
      stage: ctx.config.stage ?? 'dev-qa',
      repos: list.ok ? list.repos : [],
      ...(list.ok ? {} : { reposError: list.error }),
      chains: this.projectChains(ctx.connection)
    }
  }

  async preview(repoPath: string, stage: unknown, scope: unknown): Promise<ReleaseRepoPreview[]> {
    const ctx = await this.ready(repoPath)
    return this.readPreviews(ctx, this.client(ctx.connection), stageOf(stage), scopeOf(scope))
  }

  /**
   * What release.create (`chain` false: develop → qa or qa → prod) or release.chainStart would
   * do, read again from Azure DevOps: never what the phone showed a moment ago.
   */
  /** `input`: ReleaseRunInput as the phone sent it, checked here. */
  async plan(chain: boolean, repoPath: string, input: Record<string, unknown>): Promise<ReleasePlan> {
    const stage = chain ? 'dev-qa-prod' : stageOf(input.stage)
    if (stage === 'dev-qa-prod' && !chain) throw new Error('develop → qa → prod parte con release.chainStart')
    const scope = scopeOf(input.scope)
    const ctx = await this.ready(repoPath)
    const ado = this.client(ctx.connection)
    const previews = await this.readPreviews(ctx, ado, stage, scope)
    const items = previews.filter(p => !!p.source && !!p.target && !p.error && (chain
      ? !!p.prod && !p.chainRunning && (p.commits.length > 0 || !!p.existing || (p.prodCommits ?? 0) > 0)
      : p.commits.length > 0 && !p.existing))
    if (items.length === 0) throw new Error('nulla da rilasciare: rileggi l’anteprima')
    const autoComplete = input.autoComplete === true
    const excluded = new Set(Array.isArray(input.excluded) ? input.excluded.filter((k: unknown): k is string => typeof k === 'string') : [])
    const plan: ReleasePlan = { ctx, ado, items, autoComplete, excluded }
    if (chain) plan.confirm = this.chainConfirm(plan)
    else if (stage === 'qa-prod') plan.confirm = this.prodConfirm(plan)
    return plan
  }

  /** One PR per planned repository (develop → qa or qa → prod). */
  async create(plan: ReleasePlan): Promise<ReleaseCreated[]> {
    const out: ReleaseCreated[] = []
    for (const p of plan.items) out.push(await this.createPr(plan, p))
    return out
  }

  /**
   * develop → qa → prod: the new develop → qa PRs now (an active one is followed, nothing for qa
   * starts at qa → prod), then the desktop's chain service takes over.
   */
  async startChain(plan: ReleasePlan): Promise<{ created: ReleaseCreated[]; chain: ReleaseChainView | null }> {
    const created: ReleaseCreated[] = []
    const items: ChainStartItem[] = []
    for (const p of plan.items) {
      const branches = { dev: p.source!, qa: p.target!, prod: p.prod! }
      if (p.existing) {
        items.push({ side: p.side, repo: p.repo, branches, qaPr: p.existing })
        continue
      }
      if (p.commits.length === 0) {
        items.push({ side: p.side, repo: p.repo, branches })
        continue
      }
      const res = await this.createPr(plan, p)
      created.push(res)
      if (!res.ok || !res.pr) continue
      items.push({
        side: p.side, repo: p.repo, branches, qaPr: res.pr,
        ...(plan.autoComplete && res.mode !== 'autocomplete' ? { qaNoAutoComplete: true } : {})
      })
    }
    if (items.length === 0) return { created, chain: null }
    try {
      const chain = this.deps.chains.start({ connectionId: plan.ctx.connection.id, autoComplete: plan.autoComplete, items }, plan.ctx.connection)
      return { created, chain }
    } catch (e) {
      const kept = items.filter(i => i.qaPr).map(i => `${i.side} #${i.qaPr!.id}`)
      const error = errorText(e) || 'errore'
      throw new Error(kept.length > 0 ? `catena non avviata: ${error} (le PR ${kept.join(', ')} restano aperte)` : `catena non avviata: ${error}`)
    }
  }

  cancelChain(id: string): void {
    this.deps.chains.cancel(id)
  }

  removeChain(id: string): void {
    this.deps.chains.remove(id)
  }

  /** BE / FE repository or one branch override, saved per project as the desktop panel does. */
  async setConfig(repoPath: string, args: { beRepo?: unknown; feRepo?: unknown; branch?: unknown }): Promise<ReleaseState> {
    const ctx = await this.ready(repoPath)
    let next: PromotionConfig = ctx.config
    // same rule as the panel: a saved FE that becomes the BE goes back to automatic
    if (typeof args.beRepo === 'string') next = withBeRepo(next, await this.projectRepo(ctx, args.beRepo))
    if (typeof args.feRepo === 'string') next = { ...next, feRepo: await this.projectRepo(ctx, args.feRepo) }
    if (args.branch !== undefined) {
      const b = args.branch as { repo?: unknown; role?: unknown; name?: unknown } | null
      // the branch itself is inert: resolveEnvBranch uses it only when the remote has it
      const repo = typeof b?.repo === 'string' ? [ctx.be, ctx.fe].find(r => !!r && sameName(r, String(b.repo).trim())) : undefined
      const name = typeof b?.name === 'string' ? b.name.trim() : ''
      if (!repo || !name || !ROLES.has(b?.role)) throw new Error('branch di rilascio non valido')
      const role = b!.role as EnvRole
      next = { ...next, branches: { ...next.branches, [repo]: { ...next.branches?.[repo], [role]: name } } }
    }
    this.deps.settings.setRelease(ctx.configKey, next)
    this.deps.changed?.()
    return this.state(repoPath)
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async ready(repoPath: string): Promise<Context> {
    const ctx = await this.context(repoPath)
    if (typeof ctx === 'string') throw new Error(ctx)
    return ctx
  }

  /** Connection, repository and release choices of the folder open as `repoPath`, or why there are none. */
  private async context(repoPath: string): Promise<Context | string> {
    const settings = this.deps.settings.read()
    const { connections } = settings
    if (connections.length === 0) return 'nessuna connessione Azure DevOps: aggiungila sul desktop in Impostazioni › Azure DevOps › Connessioni'
    const main = mainFolderPath(repoPath, await this.deps.gitCommonDir(repoPath).catch(() => null))
    const key = folderKey(main)
    const saved = settings.folders[key]
    // a saved mapping needs no network; otherwise the only same-name repository of the catalogs
    const catalog: Record<string, AdoRepoList> = {}
    if (!saved || !connections.some(c => c.id === saved.connectionId)) {
      const lists = await Promise.all(connections.map(c => this.deps.repositories(c)))
      connections.forEach((c, i) => { catalog[c.id] = lists[i] })
      const failed = lists.filter((l): l is { ok: false; error: string } => !l.ok)
      if (failed.length === connections.length) return `Azure DevOps non leggibile: ${failed[0].error}`
    }
    const resolved = resolveFolderRepo(folderName(main), saved, connections, catalog)
    const connection = 'ref' in resolved ? connections.find(c => c.id === resolved.ref.connectionId) : undefined
    if (!connection || !('ref' in resolved)) {
      return `repository Azure DevOps di ${folderName(main)} non chiara: sceglila sul desktop nel pannello Rilascio`
    }
    const configKey = promotionConfigKey(connection.organization, connection.project)
    const config = settings.release[configKey] ?? {}
    const { be, fe } = releaseRepos(config, resolved.ref.repository, siblingRepos(settings.folders, connection.id, key))
    return { connection, folderRepo: resolved.ref.repository, configKey, config, be, fe }
  }

  /**
   * A repository name the phone sent, as the project lists it ('' = none): it goes into the Azure
   * DevOps URLs, so only a repository of the connection's catalog is taken.
   */
  private async projectRepo(ctx: Context, name: string): Promise<string> {
    const wanted = name.trim()
    if (!wanted) return ''
    const list = await this.deps.repositories(ctx.connection)
    const hit = list.ok ? list.repos.find(r => sameName(r, wanted)) : undefined
    if (!hit) throw new Error(list.ok ? `repository ${wanted} non trovata in ${ctx.connection.organization}/${ctx.connection.project}` : list.error)
    return hit
  }

  private client(connection: AdoConnectionConfig): ReleaseAdo {
    const token = this.deps.settings.token(connection.id)
    if (!token) throw new Error(ADO_MISSING_PAT)
    const ado = this.deps.createAdo?.() ?? new AdoService()
    ado.use(connection.organization, token)
    return ado
  }

  private projectChains(connection: AdoConnectionConfig): ReleaseChain[] {
    const key = chainProjectKey(connection.organization, connection.project)
    return this.deps.chains.list()
      .filter(c => chainProjectKey(c.organization, c.project) === key)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  private readPreviews(ctx: Context, ado: ReleaseAdo, stage: ReleaseStage, scope: ReleaseScope): Promise<ReleaseRepoPreview[]> {
    const targets: { side: ReleaseSide; repo: string }[] = []
    if (scope !== 'fe' && ctx.be) targets.push({ side: 'BE', repo: ctx.be })
    if (scope !== 'be' && ctx.fe) targets.push({ side: 'FE', repo: ctx.fe })
    if (targets.length === 0) throw new Error(scope === 'fe' ? 'scegli la repository FE del project' : 'scegli la repository BE del project')
    const chains = stage === 'dev-qa-prod' ? this.deps.chains.list() : []
    return Promise.all(targets.map(t => this.readPreview(ctx, ado, stage, t.side, t.repo, chains)))
  }

  private async readPreview(ctx: Context, ado: ReleaseAdo, stage: ReleaseStage, side: ReleaseSide, repo: string, chains: ReleaseChain[]): Promise<ReleaseRepoPreview> {
    const { organization, project } = ctx.connection
    const chainMode = stage === 'dev-qa-prod'
    const roles = STAGE_ROLES[stage === 'qa-prod' ? 'qa-prod' : 'dev-qa']
    const base: ReleaseRepoPreview = { side, repo, branches: [], source: null, target: null, commits: [], workItems: [], existing: null }
    const pr = (p: { id: number; url: string }): ReleasePr => ({ id: p.id, url: p.url || this.prUrl(ctx, repo, p.id) })
    try {
      const branches = await ado.getBranches(project, repo)
      if (branches.length === 0) return { ...base, error: `nessun branch letto da ${repo}: controlla repository e PAT` }
      const overrides = ctx.config.branches?.[repo] ?? {}
      const source = resolveEnvBranch(roles.from, branches, overrides[roles.from])
      const target = resolveEnvBranch(roles.to, branches, overrides[roles.to])
      const prod = chainMode ? resolveEnvBranch('prod', branches, overrides.prod) : undefined
      const running = chainMode && !!activeChainItem(chains, organization, project, repo)
      const found = { ...base, branches, source, target, ...(chainMode ? { prod } : {}), ...(running ? { chainRunning: true } : {}) }
      if (!source || !target || (chainMode && !prod)) return found
      // chain: strict reads, a failed one must not look like "nothing to promote" (that repository
      // would skip develop → qa and get its qa → prod PR at once)
      const commits = await ado.getCommitsBetween(project, repo, source, target, { strict: chainMode })
      const ids = extractWorkItemIds(commits.map(c => c.message))
      let workItems: ReleaseRepoPreview['workItems'] = []
      let warning: string | undefined
      if (ids.length > 0) {
        try {
          workItems = (await ado.getWorkItemsBatch(project, ids)).map(w => ({ id: w.id, title: w.title, type: w.type, state: w.state }))
        } catch {
          warning = 'work item non letti: la PR verrebbe creata senza link ai work item'
        }
      }
      const prs = await ado.getPullRequests(project, repo)
      const existing = prs.find(p => sameName(p.sourceBranch, source) && sameName(p.targetBranch, target))
      // chain with nothing to promote to qa: it starts at qa → prod, worth it only with commits
      // there and no qa → prod PR already open
      const startsAtProd = chainMode && !!prod && commits.length === 0 && !existing
      const prodExisting = startsAtProd ? prs.find(p => sameName(p.sourceBranch, target) && sameName(p.targetBranch, prod!)) : undefined
      const prodCommits = startsAtProd && !prodExisting
        ? (await ado.getCommitsBetween(project, repo, target, prod!, { strict: true })).length
        : undefined
      return {
        ...found, commits, workItems, existing: existing ? pr(existing) : null,
        ...(warning ? { warning } : {}),
        ...(prodCommits !== undefined ? { prodCommits } : {}),
        ...(startsAtProd ? { prodExisting: prodExisting ? pr(prodExisting) : null } : {})
      }
    } catch (e) {
      return { ...base, error: errorText(e) || 'lettura da Azure DevOps fallita' }
    }
  }

  private async createPr(plan: ReleasePlan, p: ReleaseRepoPreview): Promise<ReleaseCreated> {
    const items = p.workItems.filter(w => !plan.excluded.has(`${p.side}:${w.id}`))
    const res = await plan.ado.createPullRequest(plan.ctx.connection.project, p.repo, {
      sourceRef: p.source!,
      targetRef: p.target!,
      title: promotionTitle(p.source!, p.target!, p.side, new Date()),
      description: promotionDescription(items, p.commits),
      autoComplete: plan.autoComplete,
      workItemIds: items.length > 0 ? items.map(w => w.id) : undefined,
      // develop / qa are never deleted and branch policies are never bypassed
      deleteSourceBranch: false,
      forceComplete: false
    }).catch(() => null)
    if (!res) return { side: p.side, repo: p.repo, ok: false }
    return {
      side: p.side, repo: p.repo, ok: true, pr: { id: res.id, url: res.url }, mode: res.mode,
      ...(plan.autoComplete && res.mode === 'open' ? { notArmed: true } : {})
    }
  }

  private prodConfirm(plan: ReleasePlan): { summary: string; details: string } {
    const lines = plan.items.map(p => `${p.side} · ${p.repo}: ${p.source} → ${p.target} · ${commitCount(p.commits.length)} · ${itemCount(this.selected(plan, p))}`)
    const policy = plan.autoComplete
      ? 'Auto-complete armato: il merge parte quando le branch policy sono soddisfatte.'
      : 'Le PR restano aperte: approvazione e completamento seguono le branch policy.'
    return {
      summary: 'Rilascio in produzione: creare queste pull request?',
      details: `${lines.join('\n')}\n\n${policy} Nessuna policy viene bypassata e ${plan.items[0].source} non viene cancellato.`
    }
  }

  private chainConfirm(plan: ReleasePlan): { summary: string; details: string } {
    const blocks = plan.items.map(p => {
      const step1 = p.existing
        ? `PR #${p.existing.id} già attiva, la catena la segue (auto-complete non modificato)`
        : p.commits.length > 0
          ? `nuova PR · ${commitCount(p.commits.length)} · ${itemCount(this.selected(plan, p))}`
          : 'nulla da promuovere, si parte dal passo 2'
      const step2 = !p.existing && p.commits.length === 0
        ? `PR creata subito · ${commitCount(p.prodCommits ?? 0)}`
        : `PR creata appena la PR ${p.source} → ${p.target} è completata`
      return `${p.side} · ${p.repo}\n1. ${p.source} → ${p.target}: ${step1}\n2. ${p.target} → ${p.prod}: ${step2} · con tutti i work item dei suoi commit`
    })
    const policy = plan.autoComplete
      ? 'Auto-complete armato sulle PR create dalla catena (una PR già attiva viene seguita o riusata così com’è): ogni merge parte quando le branch policy sono soddisfatte.'
      : 'Le PR restano aperte: approvazione e completamento seguono le branch policy (la catena aspetta il completamento).'
    return {
      summary: 'Avviare la catena di rilascio develop → qa → prod?',
      details: 'Questa conferma vale anche per la produzione: ogni PR qa → prod viene creata da sola appena la PR develop → qa della stessa repository è completata.\n\n' +
        `${blocks.join('\n\n')}\n\n${policy} Nessuna policy viene bypassata e i branch develop e qa non vengono cancellati.`
    }
  }

  private selected(plan: ReleasePlan, p: ReleaseRepoPreview): number {
    return p.workItems.filter(w => !plan.excluded.has(`${p.side}:${w.id}`)).length
  }

  private prUrl(ctx: Context, repo: string, id: number): string {
    const { organization, project } = ctx.connection
    return `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}`
  }
}
