// Self-check for the release chain develop → qa → prod: the pure state rules
// (src/shared/adoChain.ts) and the main-process service
// (electron/services/ado/promotion-chain.service.ts) with a fake Azure DevOps in
// a temp dir, two instances on one profile. Azure DevOps itself is never called.
// Run: node --experimental-strip-types scripts/ado-chain.check.ts
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  sanitizeChains, buildChain, afterQaState, withLastError, withProdPr, withNothingToPromote, cancelChain,
  isChainActive, activeChainItem, chainConnection, chainProjectKey
} from '../src/shared/adoChain.ts'
import type { ChainItem, ChainStartInput, ReleaseChain } from '../src/shared/adoChain.ts'
import { sanitizePromotionConfig } from '../src/shared/adoSettings.ts'

// electron/ imports its siblings without an extension (bundler style): let node find the .ts
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (e) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context)
      throw e
    }
  }
})
const { PromotionChainService } = await import('../electron/services/ado/promotion-chain.service.ts')

const branches = { dev: 'develop', qa: 'qa', prod: 'main' }
const conn = { id: 'c1', organization: 'Contoso', project: 'Themis' }
const T0 = 1_000

// ── the release stage is saved with the release config ────────────────────
assert.equal(sanitizePromotionConfig({ stage: 'dev-qa-prod' }).stage, 'dev-qa-prod')
assert.equal(sanitizePromotionConfig({ stage: 'qa-prod', feRepo: 'X' }).stage, 'qa-prod')
assert.equal(sanitizePromotionConfig({ stage: 'prod' }).stage, undefined, 'an unknown stage is dropped')

// ── buildChain ────────────────────────────────────────────────────────────
const input: ChainStartInput = {
  connectionId: 'c1',
  autoComplete: true,
  items: [
    { side: 'BE', repo: 'Themis-API', branches, qaPr: { id: 501, url: 'https://x/501' } },
    { side: 'FE', repo: 'Themis-Frontend', branches, qaPr: null }
  ]
}
const chain = buildChain(input, conn, [], 'k1', T0)
assert.deepEqual(chain, {
  id: 'k1', connectionId: 'c1', organization: 'Contoso', project: 'Themis', autoComplete: true, createdAt: T0,
  items: [
    { side: 'BE', repo: 'Themis-API', branches, qaPr: { id: 501, url: 'https://x/501' }, status: 'waiting-qa', updatedAt: T0 },
    // nothing to promote to qa: the item starts at qa → prod
    { side: 'FE', repo: 'Themis-Frontend', branches, status: 'creating-prod', updatedAt: T0 }
  ]
})
assert.throws(() => buildChain({ ...input, items: [] }, conn, [], 'k', T0), /nessuna repository da rilasciare/)
assert.throws(() => buildChain({ ...input, items: [{ side: 'BE', repo: 'X', branches: { dev: 'develop', qa: '', prod: 'main' } }] }, conn, [], 'k', T0),
  /branch develop \/ qa \/ prod mancanti per X/)
assert.throws(() => buildChain({ ...input, items: [input.items[0], { ...input.items[0], repo: 'Other' }] }, conn, [], 'k', T0), /BE ripetuto/)
assert.throws(() => buildChain({ ...input, items: [{ side: 'XX' as 'BE', repo: 'X', branches }] }, conn, [], 'k', T0), /non valida/)
// one running chain per repository and project (case-insensitive)
assert.throws(() => buildChain({ ...input, items: [{ side: 'BE', repo: 'themis-api', branches }] }, { ...conn, organization: 'contoso' }, [chain], 'k2', T0),
  /già in corso per themis-api/)
assert.equal(buildChain({ ...input, items: [{ side: 'BE', repo: 'Themis-API', branches }] }, { ...conn, project: 'Other' }, [chain], 'k2', T0).items.length, 1,
  'the same repository name in another project is another repository')
assert.equal(activeChainItem([chain], 'contoso', 'THEMIS', 'themis-frontend')?.item.side, 'FE')
assert.equal(activeChainItem([cancelChain(chain, T0)], 'Contoso', 'Themis', 'Themis-API'), null, 'a cancelled chain no longer holds the repository')

// ── transitions ───────────────────────────────────────────────────────────
const waiting = chain.items[0]
assert.equal(afterQaState(waiting, 'active', 2), waiting, 'still open: the same item, nothing to write')
assert.deepEqual(afterQaState(waiting, 'completed', 2), { ...waiting, status: 'creating-prod', updatedAt: 2 })
assert.deepEqual(afterQaState(waiting, 'abandoned', 2), { ...waiting, status: 'failed', error: 'PR develop → qa abbandonata', updatedAt: 2 })
const flaky = withLastError(waiting, 'Azure DevOps non raggiungibile: offline', 3)
assert.equal(flaky.status, 'waiting-qa', 'a transient error keeps waiting')
assert.equal(flaky.lastError, 'Azure DevOps non raggiungibile: offline')
assert.equal(withLastError(flaky, 'Azure DevOps non raggiungibile: offline', 4), flaky, 'the same error again: nothing to write')
assert.equal(afterQaState(flaky, 'active', 5).lastError, undefined, 'an answer clears the last error')
assert.equal(withLastError({ ...waiting, status: 'done' }, 'x', 3).lastError, undefined, 'a finished item keeps no error')
const creating: ChainItem = { ...chain.items[1], lastError: 'x' }
assert.deepEqual(withProdPr(creating, { id: 9, url: 'u' }, false, 6), { ...chain.items[1], prodPr: { id: 9, url: 'u' }, status: 'done', updatedAt: 6 })
assert.equal(withProdPr(creating, { id: 9, url: 'u' }, true, 6).prodReused, true)
const cancelledLate = withProdPr({ ...creating, status: 'cancelled' }, { id: 9, url: 'u' }, false, 6)
assert.equal(cancelledLate.status, 'cancelled', 'cancelled while creating: stays cancelled')
assert.deepEqual(cancelledLate.prodPr, { id: 9, url: 'u' }, '... but the PR that exists is recorded')
assert.equal(withNothingToPromote(creating, 7).status, 'done')
assert.equal(withNothingToPromote(creating, 7).note, 'nulla da promuovere: main contiene già tutti i commit di qa')
const cancelled = cancelChain({ ...chain, items: [chain.items[0], { ...chain.items[1], status: 'done' }] }, 8)
assert.deepEqual(cancelled.items.map(i => i.status), ['cancelled', 'done'], 'only running items are cancelled')
assert.equal(isChainActive(cancelled), false)
assert.equal(isChainActive(chain), true)

// ── sanitizeChains ────────────────────────────────────────────────────────
assert.deepEqual(sanitizeChains(null), [])
assert.deepEqual(sanitizeChains({ chains: 'x' }), [])
assert.deepEqual(sanitizeChains({ chains: [chain] }), [chain], 'a valid chain round-trips')
const messy = sanitizeChains({
  chains: [
    chain,
    { ...chain }, // same id: first wins
    { ...chain, id: 'k3', items: [] },
    { ...chain, id: 'k4', items: [{ ...waiting, qaPr: undefined }] }, // waiting for nothing
    { ...chain, id: 'k5', organization: '' },
    { ...chain, id: 'k6', items: [{ ...waiting, status: 'weird' }, { ...waiting, side: 'FE', qaPr: { id: -1 } }, waiting, waiting] }
  ]
})
assert.deepEqual(messy.map(c => c.id), ['k1', 'k6'])
assert.deepEqual(messy[1].items.map(i => i.side), ['BE'], 'bad items and a repeated side are dropped')

// ── chainConnection ───────────────────────────────────────────────────────
assert.equal(chainConnection(chain, [{ id: 'c9', organization: 'x', project: 'y' }, conn])?.id, 'c1')
assert.equal(chainConnection(chain, [{ id: 'c2', organization: 'contoso', project: 'themis' }])?.id, 'c2', 'removed and added again: same org/project')
assert.equal(chainConnection(chain, [{ id: 'c1', organization: 'Contoso', project: 'Renamed' }]), undefined, 'the id now points at another project')
assert.equal(chainProjectKey(' Contoso ', 'Themis'), 'contoso/themis')

// ── the service, with a fake Azure DevOps ─────────────────────────────────
interface Call { name: string; args: unknown[] }
function fakeAdo(calls: Call[], world: {
  qaState: Record<number, string | Error>
  existingProd?: { id: number; url: string } | null
  commits?: { commitId: string; message: string; author: string }[] | Error
  workItems?: { id: number; title: string; type: string; state: string; assignedTo: string; url: string }[] | Error
  create?: { id: number; title: string; mode: 'autocomplete' | 'completed' | 'open'; url: string } | null
}) {
  const rec = (name: string, ...args: unknown[]) => calls.push({ name, args })
  return {
    use: (org: string, token: string) => rec('use', org, token),
    getPullRequestState: async (project: string, repo: string, id: number) => {
      rec('state', project, repo, id)
      const s = world.qaState[id]
      if (s instanceof Error) throw s
      return { id, status: s ?? 'active', url: `https://pr/${id}` }
    },
    findActivePullRequest: async (project: string, repo: string, source: string, target: string) => {
      rec('findActive', project, repo, source, target)
      return world.existingProd ?? null
    },
    getCommitsBetween: async (project: string, repo: string, source: string, target: string, opts?: { strict?: boolean }) => {
      rec('commits', project, repo, source, target, opts)
      if (world.commits instanceof Error) throw world.commits
      return world.commits ?? []
    },
    getWorkItemsBatch: async (project: string, ids: number[]) => {
      rec('workItems', project, ids)
      if (world.workItems instanceof Error) throw world.workItems
      return world.workItems ?? []
    },
    createPullRequest: async (project: string, repo: string, opts: Record<string, unknown>) => {
      rec('create', project, repo, opts)
      return world.create === undefined ? { id: 900, title: String(opts.title), mode: 'open' as const, url: 'https://pr/900' } : world.create
    }
  }
}

const dir = mkdtempSync(join(tmpdir(), 'damned-chain-'))
try {
  const calls: Call[] = []
  const world: Parameters<typeof fakeAdo>[1] = { qaState: {} }
  const notes: string[] = []
  const alive = new Set([100, 200])
  let changed = 0
  let clock = 10_000
  const make = (pid: number, credentials: (c: ReleaseChain) => { organization: string; token: string } | string = () => ({ organization: 'Contoso', token: 'pat-1' })) =>
    new PromotionChainService({
      dir,
      credentials,
      createAdo: () => fakeAdo(calls, world),
      changed: () => { changed++ },
      notify: (_title, body) => notes.push(body),
      now: () => clock,
      pid,
      isAlive: (p: number) => alive.has(p)
    })
  const a = make(100)
  const b = make(200)
  const names = () => calls.map(c => c.name)
  const itemOf = (svc: InstanceType<typeof PromotionChainService>, side: 'BE' | 'FE') => svc.list()[0]?.items.find(i => i.side === side)

  // start: persisted, polled at once by the owner (A takes the lock)
  world.qaState[501] = 'active'
  world.commits = [
    { commitId: 'a1', message: 'Merged PR 77: #5444 login', author: 'x' },
    { commitId: 'a2', message: 'fix #5445\n\nbody', author: 'y' }
  ]
  world.workItems = [{ id: 5444, title: 'Login', type: 'Bug', state: 'Done', assignedTo: '', url: '' }]
  const started = a.start(input, conn)
  await a.tick()
  assert.equal(started.items.length, 2)
  assert.equal(b.list().length, 1, 'another instance reads the same chains')
  assert.ok(existsSync(join(dir, 'ado-chains.lock')), 'the owner holds the lock')
  assert.ok(changed > 0, 'the windows are told')

  // BE still waits for its develop → qa PR; FE (nothing to promote to qa) got its qa → prod PR right away
  assert.equal(itemOf(a, 'BE')?.status, 'waiting-qa')
  assert.equal(itemOf(a, 'FE')?.status, 'done')
  assert.deepEqual(itemOf(a, 'FE')?.prodPr, { id: 900, url: 'https://pr/900' })
  assert.deepEqual(calls.find(c => c.name === 'use')?.args, ['Contoso', 'pat-1'], 'a dedicated client on the chain connection')
  assert.deepEqual(calls.find(c => c.name === 'state')?.args, ['Themis', 'Themis-API', 501])
  assert.deepEqual(calls.find(c => c.name === 'commits')?.args, ['Themis', 'Themis-Frontend', 'qa', 'main', { strict: true }], 'commits read strictly: an error is not "nothing to promote"')
  assert.deepEqual(calls.find(c => c.name === 'workItems')?.args, ['Themis', [5444, 5445]])
  const create = calls.find(c => c.name === 'create')
  assert.equal(create?.args[1], 'Themis-Frontend')
  const opts = create?.args[2] as Record<string, unknown>
  assert.equal(opts.sourceRef, 'qa')
  assert.equal(opts.targetRef, 'main')
  assert.match(String(opts.title), /^Release qa → main · FE · \d{4}-\d{2}-\d{2}$/)
  assert.match(String(opts.description), /## Work item \(1\)\n\n- #5444 Login \(Bug · Done\)/)
  assert.match(String(opts.description), /- fix #5445$/m, 'first line of each commit')
  assert.equal(opts.autoComplete, true, 'the chain auto-complete applies to the qa → prod PR too')
  assert.deepEqual(opts.workItemIds, [5444])
  assert.equal(opts.deleteSourceBranch, false, 'qa is never deleted')
  assert.equal(opts.forceComplete, false, 'no policy bypass')
  assert.deepEqual(notes, ['PR qa → main creata per Themis-Frontend'])

  // B is not the owner: its polls never call Azure DevOps
  calls.length = 0
  await b.tick()
  assert.deepEqual(calls, [], 'only the lock owner polls')

  // a transient error keeps waiting with lastError
  world.qaState[501] = Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND dev.azure.com') })
  await a.tick()
  assert.equal(itemOf(a, 'BE')?.status, 'waiting-qa')
  assert.equal(itemOf(a, 'BE')?.lastError, 'Azure DevOps non raggiungibile: getaddrinfo ENOTFOUND dev.azure.com')

  // the owner quits (crash, no release): B takes over at its next poll; qa PR completed -> qa → prod PR
  alive.delete(100)
  world.qaState[501] = 'completed'
  world.workItems = new Error('ADO API error: 401')
  world.create = { id: 901, title: 't', mode: 'autocomplete', url: 'https://pr/901' }
  calls.length = 0
  clock = 20_000
  await b.tick()
  assert.equal(itemOf(b, 'BE')?.status, 'done')
  assert.deepEqual(itemOf(b, 'BE')?.prodPr, { id: 901, url: 'https://pr/901' })
  assert.equal(itemOf(b, 'BE')?.lastError, undefined)
  assert.equal(itemOf(b, 'BE')?.updatedAt, 20_000)
  const create2 = calls.find(c => c.name === 'create')?.args[2] as Record<string, unknown>
  assert.equal(create2.workItemIds, undefined, 'work items not readable: the PR is created without links')
  assert.doesNotMatch(String(create2.description), /## Work item/)
  assert.equal(notes.at(-1), 'PR qa → main creata per Themis-API')
  assert.equal(isChainActive(b.list()[0]), false, 'every item finished')
  // a finished chain is not polled any more
  calls.length = 0
  await b.tick()
  assert.deepEqual(calls, [])
  b.remove(started.id)
  assert.deepEqual(b.list(), [])

  // restart: a chain left running resumes in the next instance
  world.qaState = { 601: 'active', 602: 'completed' }
  world.existingProd = { id: 77, url: 'https://pr/77' }
  const c2 = b.start({
    connectionId: 'c1', autoComplete: false,
    items: [
      { side: 'BE', repo: 'Themis-API', branches, qaPr: { id: 601, url: 'u601' } },
      { side: 'FE', repo: 'Themis-Frontend', branches, qaPr: { id: 602, url: 'u602' } }
    ]
  }, conn)
  await b.tick()
  assert.equal(itemOf(b, 'BE')?.status, 'waiting-qa')
  assert.equal(itemOf(b, 'FE')?.status, 'done', 'an active qa → prod PR is reused')
  assert.deepEqual(itemOf(b, 'FE')?.prodPr, { id: 77, url: 'https://pr/77' })
  assert.equal(itemOf(b, 'FE')?.prodReused, true)
  b.stop()
  assert.equal(existsSync(join(dir, 'ado-chains.lock')), false, 'stop releases the lock')
  alive.add(300)
  const second = make(300)
  world.qaState[601] = 'abandoned'
  await second.tick()
  assert.equal(itemOf(second, 'BE')?.status, 'failed')
  assert.equal(itemOf(second, 'BE')?.error, 'PR develop → qa abbandonata')
  assert.equal(notes.at(-1), 'catena interrotta per Themis-API: PR develop → qa abbandonata')
  second.remove(c2.id)

  // creation refused by Azure DevOps: retried with lastError; cancel stops the item before any PR
  world.existingProd = null
  world.create = null
  world.commits = [{ commitId: 'z', message: 'x', author: '' }]
  const c3 = second.start({ connectionId: 'c1', autoComplete: false, items: [{ side: 'BE', repo: 'R3', branches }] }, conn)
  await second.tick()
  assert.equal(itemOf(second, 'BE')?.status, 'creating-prod')
  assert.match(itemOf(second, 'BE')?.lastError ?? '', /creazione PR qa → main rifiutata da Azure DevOps/)
  assert.throws(() => second.start({ connectionId: 'c1', autoComplete: false, items: [{ side: 'FE', repo: 'r3', branches }] }, conn), /già in corso per r3/)
  assert.throws(() => second.remove(c3.id), /ancora in corso/)
  second.cancel(c3.id)
  assert.equal(itemOf(second, 'BE')?.status, 'cancelled')
  assert.equal(itemOf(second, 'BE')?.lastError, undefined)
  calls.length = 0
  await second.tick()
  assert.deepEqual(calls, [], 'a cancelled chain is not polled')
  assert.throws(() => second.cancel('nope'), /catena non trovata/)
  second.remove(c3.id)

  // nothing to promote from qa to prod: done with a note, no PR
  world.commits = []
  second.start({ connectionId: 'c1', autoComplete: false, items: [{ side: 'BE', repo: 'R4', branches }] }, conn)
  await second.tick()
  assert.equal(itemOf(second, 'BE')?.status, 'done')
  assert.equal(itemOf(second, 'BE')?.prodPr, undefined)
  assert.equal(itemOf(second, 'BE')?.note, 'nulla da promuovere: main contiene già tutti i commit di qa')
  second.remove(second.list()[0].id)
  second.stop()

  // the connection is gone: the item waits with the reason
  const lost = make(300, () => 'connessione Contoso/Themis non trovata')
  world.qaState[701] = 'completed'
  lost.start({ connectionId: 'c1', autoComplete: false, items: [{ side: 'BE', repo: 'R5', branches, qaPr: { id: 701, url: '' } }] }, conn)
  await lost.tick()
  assert.equal(itemOf(lost, 'BE')?.status, 'waiting-qa')
  assert.equal(itemOf(lost, 'BE')?.lastError, 'connessione Contoso/Themis non trovata')
  lost.cancel(lost.list()[0].id)
  lost.stop()

  // an unparseable file is never overwritten
  const file = join(dir, 'ado-chains.json')
  writeFileSync(file, '{ broken')
  const svc = make(300)
  assert.deepEqual(svc.list(), [], 'a broken file reads as no chain')
  assert.throws(() => svc.start(input, conn), /non leggibile/)
  assert.equal(readFileSync(file, 'utf8'), '{ broken')
  svc.stop()
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ── the AdoService reads the chain uses (globalThis.fetch stubbed) ────────
{
  const { AdoService } = await import('../electron/services/ado/ado.service.ts')
  const urls: string[] = []
  let reply: () => Response | Error = () => new Response('{}')
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input))
    const r = reply()
    if (r instanceof Error) throw r
    return r
  }) as typeof fetch
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const ado = new AdoService()
  ado.use('contoso', 'pat')

  reply = () => json({ pullRequestId: 501, status: 'completed' })
  assert.deepEqual(await ado.getPullRequestState('My Project', 'Themis-API', 501),
    { id: 501, status: 'completed', url: 'https://dev.azure.com/contoso/My%20Project/_git/Themis-API/pullrequest/501' })
  assert.equal(urls.at(-1), 'https://dev.azure.com/contoso/My%20Project/_apis/git/repositories/Themis-API/pullrequests/501?api-version=7.0')

  reply = () => json({ value: [{ pullRequestId: 77 }] })
  assert.deepEqual(await ado.findActivePullRequest('Themis', 'Themis-API', 'qa', 'main'),
    { id: 77, url: 'https://dev.azure.com/contoso/Themis/_git/Themis-API/pullrequest/77' })
  assert.equal(urls.at(-1), 'https://dev.azure.com/contoso/Themis/_apis/git/repositories/Themis-API/pullrequests?searchCriteria.status=active&searchCriteria.sourceRefName=refs%2Fheads%2Fqa&searchCriteria.targetRefName=refs%2Fheads%2Fmain&api-version=7.0')
  reply = () => json({ value: [] })
  assert.equal(await ado.findActivePullRequest('Themis', 'Themis-API', 'qa', 'main'), null)

  reply = () => json({ value: [{ commitId: 'a', comment: 'fix #1', author: { name: 'x' } }] })
  assert.deepEqual(await ado.getCommitsBetween('Themis', 'Themis-API', 'qa', 'main', { strict: true }), [{ commitId: 'a', message: 'fix #1', author: 'x' }])
  // not strict (the Release panel): an error still reads as no commit
  reply = () => new Response('', { status: 500 })
  assert.deepEqual(await ado.getCommitsBetween('Themis', 'Themis-API', 'qa', 'main'), [])
  // strict: every failure is a readable error, never "nothing to promote"
  await assert.rejects(ado.getCommitsBetween('Themis', 'Themis-API', 'qa', 'main', { strict: true }), /^Error: errore Azure DevOps 500$/)
  reply = () => new Response('', { status: 401 })
  await assert.rejects(ado.getPullRequestState('Themis', 'R', 1), /PAT non valido, scaduto o senza permesso Code \(Read\)/)
  reply = () => new Response('<html>sign in</html>', { status: 203 })
  await assert.rejects(ado.getPullRequestState('Themis', 'R', 1), /PAT non valido o scaduto/)
  reply = () => new Response('<html>sign in</html>', { status: 200 })
  await assert.rejects(ado.findActivePullRequest('Themis', 'R', 'qa', 'main'), /PAT non valido o scaduto/)
  reply = () => new Response('', { status: 404 })
  await assert.rejects(ado.getPullRequestState('Themis', 'R', 1), /non trovato in Azure DevOps/)
  reply = () => Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND dev.azure.com') })
  await assert.rejects(ado.getPullRequestState('Themis', 'R', 1), /Azure DevOps non raggiungibile: getaddrinfo ENOTFOUND dev\.azure\.com/)
}
console.log('ok — ado-chain')
