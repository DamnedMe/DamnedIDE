// Release chain develop → qa → prod: the develop → qa pull request first, then,
// as soon as Azure DevOps reports it completed, the qa → prod one. The main
// process (electron/services/ado/promotion-chain.service.ts) keeps the chains in
// userData/ado-chains.json and polls them; these are the pure state rules, shared
// with the Release panel and scripts/ado-chain.check.ts: type imports only, so
// plain node can run it.
import type { AdoConnectionConfig } from './adoSettings'

export type ChainSide = 'BE' | 'FE'

/**
 * waiting-qa: the develop → qa PR is not completed yet; creating-prod: it is
 * (or develop → qa had nothing to promote) and the qa → prod PR is being
 * created; done: the qa → prod PR exists (or there was nothing to promote);
 * failed: the chain stopped (`error`); cancelled: by the user.
 */
export type ChainStatus = 'waiting-qa' | 'creating-prod' | 'done' | 'failed' | 'cancelled'

export interface ChainPr {
  id: number
  url: string
}

/** Branch names as resolved by the Release panel (overrides included). */
export interface ChainBranches {
  dev: string
  qa: string
  prod: string
}

export interface ChainItem {
  side: ChainSide
  repo: string
  branches: ChainBranches
  /** the develop → qa PR; absent when develop → qa had nothing to promote (the item starts at qa → prod) */
  qaPr?: ChainPr
  /** the qa → prod PR, once created (or an active one found and followed) */
  prodPr?: ChainPr
  /** prodPr was already active: it was reused, not created */
  prodReused?: boolean
  status: ChainStatus
  /** why the item stopped (failed) */
  error?: string
  /** last transient error (network, PAT, branch policy): the item keeps waiting and is retried */
  lastError?: string
  /** done without a qa → prod PR: why */
  note?: string
  updatedAt: number
}

export interface ReleaseChain {
  id: string
  connectionId: string
  organization: string
  project: string
  /** auto-complete armed on the PRs the chain creates; an active PR it follows or reuses is left as it is (policies are never bypassed) */
  autoComplete: boolean
  createdAt: number
  items: ChainItem[]
}

export interface ChainStartItem {
  side: ChainSide
  repo: string
  branches: ChainBranches
  /** the develop → qa PR just created or the active one found; none: nothing to promote to qa */
  qaPr?: ChainPr | null
}

/** adoChain:start input: organization and project come from the saved connection. */
export interface ChainStartInput {
  connectionId: string
  autoComplete: boolean
  items: ChainStartItem[]
}

/** How often the owner instance asks Azure DevOps about the develop → qa PRs. */
export const CHAIN_POLL_MS = 30_000

const SIDES: ReadonlySet<unknown> = new Set<ChainSide>(['BE', 'FE'])
const STATUSES: ReadonlySet<unknown> = new Set<ChainStatus>(['waiting-qa', 'creating-prod', 'done', 'failed', 'cancelled'])

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const optText = (v: unknown): string | undefined => text(v) || undefined
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Same rule as promotionConfigKey (adoPromotion.ts), repeated to keep this module import-free. */
export function chainProjectKey(org: string, project: string): string {
  return `${org.trim()}/${project.trim()}`.toLowerCase()
}

/** Still moving: the owner polls it. */
export const isActiveStatus = (s: ChainStatus): boolean => s === 'waiting-qa' || s === 'creating-prod'

export const isChainActive = (chain: ReleaseChain): boolean => chain.items.some(i => isActiveStatus(i.status))

function sanitizePr(raw: unknown): ChainPr | undefined {
  if (!isRecord(raw)) return undefined
  const id = Number(raw.id)
  if (!Number.isInteger(id) || id <= 0) return undefined
  return { id, url: text(raw.url) }
}

function sanitizeBranches(raw: unknown): ChainBranches | null {
  if (!isRecord(raw)) return null
  const dev = text(raw.dev)
  const qa = text(raw.qa)
  const prod = text(raw.prod)
  return dev && qa && prod ? { dev, qa, prod } : null
}

function sanitizeItem(raw: unknown): ChainItem | null {
  if (!isRecord(raw) || !SIDES.has(raw.side) || !STATUSES.has(raw.status)) return null
  const repo = text(raw.repo)
  const branches = sanitizeBranches(raw.branches)
  if (!repo || !branches) return null
  const item: ChainItem = {
    side: raw.side as ChainSide,
    repo,
    branches,
    status: raw.status as ChainStatus,
    updatedAt: Number(raw.updatedAt) || 0
  }
  const qaPr = sanitizePr(raw.qaPr)
  const prodPr = sanitizePr(raw.prodPr)
  // waiting for a develop → qa PR that is not there: nothing to wait for
  if (item.status === 'waiting-qa' && !qaPr) return null
  if (qaPr) item.qaPr = qaPr
  if (prodPr) item.prodPr = prodPr
  if (raw.prodReused === true) item.prodReused = true
  const error = optText(raw.error)
  const lastError = optText(raw.lastError)
  const note = optText(raw.note)
  if (error) item.error = error
  if (lastError) item.lastError = lastError
  if (note) item.note = note
  return item
}

/** Tolerant parse of `ado-chains.json` ({ chains: [...] }): anything malformed is dropped, never thrown. */
export function sanitizeChains(raw: unknown): ReleaseChain[] {
  const list = isRecord(raw) && Array.isArray(raw.chains) ? raw.chains : []
  const out: ReleaseChain[] = []
  const ids = new Set<string>()
  for (const c of list) {
    if (!isRecord(c)) continue
    const id = text(c.id)
    const connectionId = text(c.connectionId)
    const organization = text(c.organization)
    const project = text(c.project)
    if (!id || ids.has(id) || !connectionId || !organization || !project) continue
    const items: ChainItem[] = []
    for (const i of Array.isArray(c.items) ? c.items : []) {
      const item = sanitizeItem(i)
      if (item && !items.some(x => x.side === item.side)) items.push(item)
    }
    if (items.length === 0) continue
    ids.add(id)
    out.push({ id, connectionId, organization, project, autoComplete: c.autoComplete === true, createdAt: Number(c.createdAt) || 0, items })
  }
  return out
}

/** The active chain item of `repo` in that org/project, if any (a repository is in one running chain at a time). */
export function activeChainItem(chains: ReleaseChain[], org: string, project: string, repo: string): { chain: ReleaseChain; item: ChainItem } | null {
  const key = chainProjectKey(org, project)
  for (const chain of chains) {
    if (chainProjectKey(chain.organization, chain.project) !== key) continue
    const item = chain.items.find(i => isActiveStatus(i.status) && sameName(i.repo, repo))
    if (item) return { chain, item }
  }
  return null
}

/**
 * A new chain from the Release panel's input: an item with its develop → qa PR
 * waits for it, one without (nothing to promote to qa) starts at qa → prod.
 * Throws an Italian message on a bad input or a repository already in a running chain.
 */
export function buildChain(
  input: ChainStartInput,
  connection: Pick<AdoConnectionConfig, 'id' | 'organization' | 'project'>,
  existing: ReleaseChain[],
  id: string,
  now: number
): ReleaseChain {
  const raw = isRecord(input) && Array.isArray(input.items) ? input.items : []
  if (raw.length === 0) throw new Error('nessuna repository da rilasciare')
  const items: ChainItem[] = []
  for (const r of raw) {
    const side = isRecord(r) ? r.side : undefined
    const repo = isRecord(r) ? text(r.repo) : ''
    if (!SIDES.has(side) || !repo) throw new Error('repository della catena non valida')
    const branches = sanitizeBranches(isRecord(r) ? r.branches : undefined)
    if (!branches) throw new Error(`branch develop / qa / prod mancanti per ${repo}`)
    if (items.some(i => i.side === side)) throw new Error(`${String(side)} ripetuto nella catena`)
    if (activeChainItem(existing, connection.organization, connection.project, repo)) {
      throw new Error(`una catena di rilascio è già in corso per ${repo}: annullala prima di avviarne un'altra`)
    }
    const qaPr = sanitizePr(isRecord(r) ? r.qaPr : undefined)
    items.push(qaPr
      ? { side: side as ChainSide, repo, branches, qaPr, status: 'waiting-qa', updatedAt: now }
      : { side: side as ChainSide, repo, branches, status: 'creating-prod', updatedAt: now })
  }
  return {
    id,
    connectionId: connection.id,
    organization: connection.organization,
    project: connection.project,
    autoComplete: input.autoComplete === true,
    createdAt: now,
    items
  }
}

/** `item` with `patch`, stamped `now`, without the last transient error. */
function settled(item: ChainItem, patch: Partial<ChainItem>, now: number): ChainItem {
  const next: ChainItem = { ...item, ...patch, updatedAt: now }
  delete next.lastError
  return next
}

/**
 * After reading the develop → qa PR's status: completed → creating-prod,
 * abandoned → failed, anything else (active) keeps waiting. A successful read
 * clears the last transient error; nothing else changes the item (same object).
 */
export function afterQaState(item: ChainItem, state: string, now: number): ChainItem {
  if (item.status !== 'waiting-qa') return item
  const s = state.trim().toLowerCase()
  if (s === 'completed') return settled(item, { status: 'creating-prod' }, now)
  if (s === 'abandoned') return settled(item, { status: 'failed', error: `PR ${item.branches.dev} → ${item.branches.qa} abbandonata` }, now)
  return item.lastError === undefined ? item : settled(item, {}, now)
}

/** A transient error: the item keeps its status and is retried at the next poll. */
export function withLastError(item: ChainItem, message: string, now: number): ChainItem {
  if (!isActiveStatus(item.status) || item.lastError === message) return item
  return { ...item, lastError: message, updatedAt: now }
}

/**
 * The qa → prod PR exists (created, or an active one `reused`). Recorded even
 * when the user cancelled meanwhile (the PR is real), but only a running item becomes done.
 */
export function withProdPr(item: ChainItem, pr: ChainPr, reused: boolean, now: number): ChainItem {
  const next = settled(item, { prodPr: pr }, now)
  if (reused) next.prodReused = true
  else delete next.prodReused
  if (isActiveStatus(item.status)) next.status = 'done'
  return next
}

/** qa → prod has no commit (prod already has everything): done without a PR. */
export function withNothingToPromote(item: ChainItem, now: number): ChainItem {
  if (item.status !== 'creating-prod') return item
  return settled(item, { status: 'done', note: `nulla da promuovere: ${item.branches.prod} contiene già tutti i commit di ${item.branches.qa}` }, now)
}

/** Every item still running becomes cancelled (the PRs already created stay as they are in Azure DevOps). */
export function cancelChain(chain: ReleaseChain, now: number): ReleaseChain {
  return { ...chain, items: chain.items.map(i => (isActiveStatus(i.status) ? settled(i, { status: 'cancelled' }, now) : i)) }
}

/**
 * The saved connection a chain uses: its own id while it still points at the
 * same org/project, else any connection on that org/project (removed and added
 * again); undefined when there is none.
 */
export function chainConnection<C extends AdoConnectionConfig>(chain: ReleaseChain, connections: C[]): C | undefined {
  const key = chainProjectKey(chain.organization, chain.project)
  const sameProject = (c: C) => chainProjectKey(c.organization, c.project) === key
  return connections.find(c => c.id === chain.connectionId && sameProject(c)) ?? connections.find(sameProject)
}
