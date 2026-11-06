// Release chains develop → qa → prod (pure rules in src/shared/adoChain.ts): the
// Release panel creates the develop → qa pull requests and hands their ids over;
// from here the instance owning userData/ado-chains.lock polls them every 30 s
// and, as soon as one is completed, creates the qa → prod pull request of that
// repository (an active one is reused), then follows that one until it is
// completed (or abandoned). Chains live in userData/ado-chains.json,
// shared by every IDE instance: read fresh on every call, each change re-reads
// the file right before its atomic write and touches only its own chain/item, so
// a chain started or cancelled by another instance is kept; a file that cannot
// be parsed is never overwritten. Chains left running resume after a restart.
// ponytail: no file lock, so two instances writing in the same instant can still drop one change (as in ado-settings.store.ts)
// No electron import: main wires the PATs, the notifications and the windows.
import { mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { AdoService } from './ado.service'
import { readJson, readJsonStrict, writeJson } from './ado-settings.store'
import { acquireInstanceLock, releaseInstanceLock } from '../process/instance-lock'
import { extractWorkItemIds, promotionDescription, promotionTitle } from '../../../src/shared/adoPromotion'
import type { PromotionWorkItem } from '../../../src/shared/adoPromotion'
import {
  CHAIN_POLL_MS, afterProdState, afterQaState, buildChain, cancelChain, isActiveStatus, isChainActive, sanitizeChains,
  withLastError, withNothingToPromote, withProdPr
} from '../../../src/shared/adoChain'
import type { ChainItem, ChainSide, ChainStartInput, ChainStatus, ReleaseChain } from '../../../src/shared/adoChain'
import type { AdoConnectionConfig } from '../../../src/shared/adoSettings'

/** What the chain needs from Azure DevOps (a dedicated AdoService in the app, a fake in scripts/ado-chain.check.ts). */
export type ChainAdo = Pick<AdoService,
  'use' | 'getPullRequestState' | 'findActivePullRequest' | 'getCommitsBetween' | 'getWorkItemsBatch' | 'createPullRequest'>

export interface PromotionChainDeps {
  /** userData: ado-chains.json and ado-chains.lock */
  dir: string
  /** organization + PAT of a chain's connection, or why it cannot be used (kept as the item's last error) */
  credentials: (chain: ReleaseChain) => { organization: string; token: string } | string
  /** a new client per chain and poll, never the panels' singleton (default: new AdoService()) */
  createAdo?: () => ChainAdo
  /** the chains changed: written here or, seen at a poll, by another instance */
  changed?: () => void
  /** OS notification */
  notify?: (title: string, body: string) => void
  now?: () => number
  pid?: number
  isAlive?: (pid: number) => boolean
}

const NOTIFY_TITLE = 'DamnedIDE · rilascio'

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** fetch's "fetch failed" hides the reason in `cause`. */
function errorText(e: unknown): string {
  const err = e as Error & { cause?: { message?: string } }
  if (err?.name === 'TypeError' && err.cause?.message) return `Azure DevOps non raggiungibile: ${err.cause.message}`
  return err?.message || String(e) || 'errore Azure DevOps'
}

export class PromotionChainService {
  private readonly deps: PromotionChainDeps
  private readonly file: string
  private readonly lockFile: string
  private readonly pid: number
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking: Promise<void> | null = null
  private rerun = false
  private stopped = false
  /** the file as this instance last saw or wrote it: a different text at a poll was written by another instance */
  private lastSeen: string

  constructor(deps: PromotionChainDeps) {
    this.deps = deps
    this.file = join(deps.dir, 'ado-chains.json')
    this.lockFile = join(deps.dir, 'ado-chains.lock')
    this.pid = deps.pid ?? process.pid
    this.lastSeen = readText(this.file)
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** Every chain, fresh from disk (a broken file reads as none). */
  list(): ReleaseChain[] {
    return sanitizeChains(readJson(this.file))
  }

  /** A new chain on that saved connection (see buildChain); polled at once. */
  start(input: ChainStartInput, connection: AdoConnectionConfig): ReleaseChain {
    let created!: ReleaseChain
    this.update(chains => {
      created = buildChain(input, connection, chains, randomUUID(), this.now())
      return [...chains, created]
    })
    void this.tick()
    return created
  }

  /** Stops the items still running; the PRs already created stay in Azure DevOps. */
  cancel(id: string): void {
    this.update(chains => {
      const i = chains.findIndex(c => c.id === id)
      if (i < 0) throw new Error('catena non trovata: è stata rimossa nel frattempo')
      if (!isChainActive(chains[i])) return false
      chains[i] = cancelChain(chains[i], this.now())
      return chains
    })
  }

  /** Only a finished chain (done, failed or cancelled) can be removed. */
  remove(id: string): void {
    this.update(chains => {
      const chain = chains.find(c => c.id === id)
      if (!chain) return false
      if (isChainActive(chain)) throw new Error('la catena è ancora in corso: annullala prima di rimuoverla')
      return chains.filter(c => c.id !== id)
    })
  }

  /** Polls now (chains left running by a previous session resume) and every `intervalMs`. */
  startPolling(intervalMs = CHAIN_POLL_MS): void {
    if (this.timer || this.stopped) return
    void this.tick()
    this.timer = setInterval(() => { void this.tick() }, intervalMs)
  }

  /** On quit: no more polls, the lock goes to the next instance. */
  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    releaseInstanceLock(this.lockFile, this.pid)
  }

  /**
   * One poll: the lock owner advances every running item (one at a time, one
   * client per chain); any instance announces a file another instance changed.
   * A call during a poll runs one more right after it.
   */
  tick(): Promise<void> {
    if (this.ticking) {
      this.rerun = true
      return this.ticking
    }
    const run = async () => {
      do {
        this.rerun = false
        await this.poll()
      } while (this.rerun && !this.stopped)
    }
    this.ticking = run().finally(() => { this.ticking = null })
    return this.ticking
  }

  private async poll(): Promise<void> {
    try {
      // the owner may have quit: every poll tries to take over
      if (!this.stopped && acquireInstanceLock(this.lockFile, this.pid, this.deps.isAlive)) {
        for (const chain of this.list()) {
          if (isChainActive(chain)) await this.advanceChain(chain)
        }
      }
    } catch (e) {
      console.error('[ado-chain]', errorText(e))
    }
    const raw = readText(this.file)
    if (raw !== this.lastSeen) {
      this.lastSeen = raw
      this.deps.changed?.()
    }
  }

  private async advanceChain(chain: ReleaseChain): Promise<void> {
    const running = chain.items.filter(i => isActiveStatus(i.status))
    const credentials = this.deps.credentials(chain)
    if (typeof credentials === 'string') {
      for (const item of running) this.patchItem(chain.id, item.side, item.status, i => withLastError(i, credentials, this.now()))
      return
    }
    const ado = this.deps.createAdo?.() ?? new AdoService()
    ado.use(credentials.organization, credentials.token)
    for (const item of running) await this.advanceItem(chain, item, ado)
  }

  private async advanceItem(chain: ReleaseChain, item: ChainItem, ado: ChainAdo): Promise<void> {
    let current: ChainItem | null = item
    try {
      if (current.status === 'waiting-qa' && current.qaPr) {
        const pr = await ado.getPullRequestState(chain.project, current.repo, current.qaPr.id)
        current = this.patchItem(chain.id, current.side, 'waiting-qa', i => afterQaState(i, pr.status, this.now()))
      } else if (current.status === 'waiting-prod' && current.prodPr) {
        const pr = await ado.getPullRequestState(chain.project, current.repo, current.prodPr.id)
        current = this.patchItem(chain.id, current.side, 'waiting-prod', i => afterProdState(i, pr.status, this.now()))
        if (current?.status === 'done') this.deps.notify?.(NOTIFY_TITLE, `rilascio in ${current.branches.prod} completato per ${current.repo}`)
      }
      if (current?.status === 'failed') this.deps.notify?.(NOTIFY_TITLE, `catena interrotta per ${current.repo}: ${current.error}`)
      if (current?.status === 'creating-prod') await this.createProdPr(chain, current, ado)
    } catch (e) {
      // transient (network, PAT, policy): keep waiting, retried at the next poll
      const message = errorText(e)
      if (current) this.patchItem(chain.id, current.side, current.status, i => withLastError(i, message, this.now()))
    }
  }

  private async createProdPr(chain: ReleaseChain, item: ChainItem, ado: ChainAdo): Promise<void> {
    const { project, id: chainId } = chain
    const { repo, side } = item
    const { qa, prod } = item.branches
    const existing = await ado.findActivePullRequest(project, repo, qa, prod)
    if (existing) {
      this.patchItem(chainId, side, 'creating-prod', i => withProdPr(i, existing, true, this.now()))
      return
    }
    const commits = await ado.getCommitsBetween(project, repo, qa, prod, { strict: true })
    if (commits.length === 0) {
      this.patchItem(chainId, side, 'creating-prod', i => withNothingToPromote(i, this.now()))
      return
    }
    const ids = extractWorkItemIds(commits.map(c => c.message))
    let workItems: PromotionWorkItem[] = []
    if (ids.length > 0) {
      // as in the Release panel: unreadable work items only cost the links
      try { workItems = await ado.getWorkItemsBatch(project, ids) } catch { workItems = [] }
    }
    // the user may have cancelled while Azure DevOps answered
    if (this.list().find(c => c.id === chainId)?.items.find(i => i.side === side)?.status !== 'creating-prod') return
    const created = await ado.createPullRequest(project, repo, {
      sourceRef: qa,
      targetRef: prod,
      title: promotionTitle(qa, prod, side, new Date(this.now())),
      description: promotionDescription(workItems, commits),
      autoComplete: chain.autoComplete,
      workItemIds: workItems.length > 0 ? workItems.map(w => w.id) : undefined,
      // qa is never deleted and branch policies are never bypassed
      deleteSourceBranch: false,
      forceComplete: false
    })
    if (!created) throw new Error(`creazione PR ${qa} → ${prod} rifiutata da Azure DevOps: controlla branch policy e permessi del PAT`)
    const noAutoComplete = chain.autoComplete && created.mode !== 'autocomplete'
    // recorded whatever happened meanwhile: the PR exists
    this.patchItem(chainId, side, null, i => {
      const next = withProdPr(i, { id: created.id, url: created.url }, false, this.now())
      return noAutoComplete ? { ...next, prodNoAutoComplete: true } : next
    })
    this.deps.notify?.(NOTIFY_TITLE, `PR ${qa} → ${prod} creata per ${repo}${noAutoComplete ? ' (auto-complete non armato)' : ''}`)
  }

  /**
   * Read-modify-write of one item: skipped when it is gone or its status is no
   * longer `expected` (cancelled or advanced elsewhere). The item as it is now,
   * null when skipped.
   */
  private patchItem(chainId: string, side: ChainSide, expected: ChainStatus | null, fn: (item: ChainItem) => ChainItem): ChainItem | null {
    let result = null as ChainItem | null
    this.update(chains => {
      const chain = chains.find(c => c.id === chainId)
      const index = chain ? chain.items.findIndex(i => i.side === side) : -1
      if (!chain || index < 0) return false
      const current = chain.items[index]
      if (expected && current.status !== expected) return false
      const next = fn(current)
      result = next
      if (next === current) return false
      chain.items[index] = next
      return chains
    })
    return result
  }

  /** `mutate` gets a fresh copy (strict read) and returns the new list, or false to skip the write. */
  private update(mutate: (chains: ReleaseChain[]) => ReleaseChain[] | false): void {
    const chains = sanitizeChains(readJsonStrict(this.file))
    const next = mutate(chains)
    if (next === false) return
    mkdirSync(this.deps.dir, { recursive: true })
    // 0.0.24 drops an item with an unknown status (and a chain left empty) when it rewrites
    // this file: waiting-prod goes to disk as done (prodPr, no prodDone), which sanitize
    // reads back as waiting-prod
    const disk = next.map(c => ({ ...c, items: c.items.map(i => (i.status === 'waiting-prod' ? { ...i, status: 'done' as const } : i)) }))
    writeJson(this.file, { chains: disk })
    this.lastSeen = readText(this.file)
    this.deps.changed?.()
  }
}
