// Self-check for the DamnedCloud bridge end to end: the real RemoteWsServer + RemoteCommands with
// the real git services on a temp repository, driven over a ws client the way the phone does.
// Only SQL is a fake that records the batch and the queryId it receives, and the cancels.
// Run: node --experimental-strip-types scripts/remote-bridge.check.ts
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import WebSocket from 'ws'

registerHooks({
  // electron/ imports its siblings without an extension (bundler style): let node find the .ts
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (e) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context)
      throw e
    }
  },
  // electron/ is compiled by esbuild, which type stripping cannot stand in for here: constructor
  // parameter properties, and imports used only as types (SimpleGit, SqlService → electron + mssql)
  load(url, context, next) {
    if (!/\/electron\/.*\.ts$/.test(url)) return next(url, context)
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf-8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
})
const { RemoteWsServer } = await import('../electron/services/remote/transports/ws-server.ts')
const { DeviceRegistry } = await import('../electron/services/remote/auth/device-registry.ts')
const { PairingService } = await import('../electron/services/remote/auth/pairing.ts')
const { WorkspaceState } = await import('../electron/services/remote/workspace-state.ts')
const { GitService } = await import('../electron/services/git/git.service.ts')
const { DiffService } = await import('../electron/services/git/diff.service.ts')
const { WorktreeService } = await import('../electron/services/git/worktree.service.ts')
const { PROTOCOL_VERSION } = await import('../src/shared/remote/protocol.ts')

setTimeout(() => {
  console.error('remote bridge check: hard timeout')
  process.exit(2)
}, 60000).unref()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, what: string, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleep(10)
  }
}

// ── temp repository: tracked.txt committed as "v1", then edited (unstaged) ──
const root = mkdtempSync(join(tmpdir(), 'damned-bridge-'))
const repo = join(root, 'repo')
mkdirSync(repo)
const git = (args: string[]) => execFileSync('git', args, { cwd: repo, windowsHide: true })
git(['init', '-q'])
git(['config', 'user.email', 'test@test.local'])
git(['config', 'user.name', 'test'])
git(['config', 'core.autocrlf', 'false'])
writeFileSync(join(repo, 'tracked.txt'), 'v1\n')
git(['add', '.'])
git(['commit', '-q', '-m', 'init'])
writeFileSync(join(repo, 'tracked.txt'), 'v2\n')
// outside the workspace: git.discard must never reach it
writeFileSync(join(root, 'victim.txt'), 'keep me\n')
// a linked worktree next to the checkout (inside the sandbox), and a repository that is not
const wt = join(root, 'wt')
git(['worktree', 'add', '-q', '-b', 'feat', wt])
const other = join(root, 'other')
mkdirSync(other)
execFileSync('git', ['init', '-q'], { cwd: other, windowsHide: true })

// ── bridge ──
const registry = new DeviceRegistry(mkdtempSync(join(tmpdir(), 'damned-bridge-reg-')))
const pairing = new PairingService()
const workspace = new WorkspaceState()
workspace.update({ repoPath: repo })
const sqlCalls: { connectionId: string; query: string; maxRows?: number; database?: string }[] = []
const sqlQueryIds: string[] = []
const sqlCanceled: string[] = []
const sql = {
  executeQuery: async (connectionId: string, query: string, queryId: string, maxRows?: number, database?: string) => {
    sqlCalls.push({ connectionId, query, maxRows, database })
    sqlQueryIds.push(queryId)
    return { queryId, results: [], totalRowCount: 0, truncated: false, maxRows, elapsedMs: 1, canceled: false, rowsAffected: [] }
  },
  cancelQuery: (queryId: string) => void sqlCanceled.push(queryId)
}
const pairingRequests: { id: string; code: string }[] = []
let deviceChanges = 0
const server = new RemoteWsServer(
  registry,
  pairing,
  workspace,
  {
    git: new GitService(),
    worktree: new WorktreeService(),
    diff: new DiffService(),
    sql: sql as never,
    appVersion: '0.0.0-check',
    platform: process.platform,
    getSqlConnections: () => []
  },
  {
    onPairingRequest: (request) => void pairingRequests.push(request),
    onPairingResolved: () => {},
    onDeviceChanged: () => void deviceChanges++
  }
)
const port = 20000 + Math.floor(Math.random() * 20000)
await server.start({ host: '127.0.0.1', port })

// ── phone-like client ──
interface Res { ok: boolean; data?: any; error?: { code: string; message: string; challenge?: { id: string } } }
interface Phone {
  ws: WebSocket
  events: { topic: string; data: any }[]
  closeCode: () => number | null
  req: (cmd: string, args?: unknown) => Promise<Res>
}
async function phone(): Promise<Phone> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const events: Phone['events'] = []
  const waiting = new Map<string, (res: Res) => void>()
  let closeCode: number | null = null
  let n = 0
  ws.on('close', (code) => (closeCode = code))
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.kind === 'evt') events.push({ topic: m.topic, data: m.data })
    else if (m.kind === 'res') waiting.get(m.id)?.(m)
  })
  await new Promise((r, j) => {
    ws.once('open', r)
    ws.once('error', j)
  })
  const req = (cmd: string, args?: unknown) =>
    new Promise<Res>((resolve) => {
      const id = `r${++n}`
      waiting.set(id, resolve)
      ws.send(JSON.stringify({ v: PROTOCOL_VERSION, id, kind: 'req', cmd, args }))
    })
  return { ws, events, closeCode: () => closeCode, req }
}
const errCode = (res: Res) => (res.ok ? 'ok' : res.error?.code)
/** A destructive command: asked once, then sent again with the challenge the bridge returned. */
async function confirmed(p: Phone, cmd: string, args: Record<string, unknown>): Promise<Res> {
  const ask = await p.req(cmd, args)
  assert.equal(errCode(ask), 'confirmation_required', `${cmd} asks first`)
  return p.req(cmd, { ...args, confirm: ask.error!.challenge!.id })
}

// ── pair: pairing.pending carries the desktop's code, then commands work without a separate auth ──
const a = await phone()
assert.equal(errCode(await a.req('system.info')), 'unauthorized', 'nothing before pairing')
const pairToken = pairing.begin().token
const paired = a.req('pair', { token: pairToken, name: 'Pixel', platform: 'android' })
await until(() => a.events.some((e) => e.topic === 'pairing.pending'), 'pairing.pending')
assert.equal(pairingRequests.length, 1)
assert.deepEqual(a.events.find((e) => e.topic === 'pairing.pending')?.data, { code: pairingRequests[0].code }, 'the phone sees the desktop code')
server.resolvePairing(pairingRequests[0].id, true)
const pairRes = await paired
assert.ok(pairRes.ok, 'pairing accepted')
const deviceA = pairRes.data.device
const tokenA: string = pairRes.data.token
assert.deepEqual(deviceA.scopes, ['view'])
assert.ok((await a.req('system.info')).ok, 'the pairing socket is authenticated')

// read-only git needs only 'view'
const porcelain = await a.req('git.porcelain', { repoPath: repo })
assert.ok(porcelain.ok, `git.porcelain with view: ${porcelain.error?.code}`)
assert.ok(porcelain.data.unstaged.some((f: { path: string }) => f.path === 'tracked.txt'))
assert.ok((await a.req('git.status', { repoPath: repo })).ok, 'git.status with view')
assert.equal(errCode(await a.req('git.stage', { repoPath: repo, files: ['tracked.txt'] })), 'forbidden', 'git.stage still needs git')
// worktree.add / worktree.promote change the repository: 'git', not 'view'; cancelling a query needs 'sql'
assert.equal(errCode(await a.req('worktree.add', { repoPath: repo, branch: 'x', path: join(root, 'x') })), 'forbidden', 'worktree.add needs git')
assert.ok(!existsSync(join(root, 'x')))
assert.equal(errCode(await a.req('worktree.promote', { repoPath: repo, worktreePath: wt })), 'forbidden', 'worktree.promote needs git')
assert.equal(errCode(await a.req('sql.cancel', { queryId: 'remote_x' })), 'forbidden', 'sql.cancel needs sql')

// repoPath sandbox: the open repository, its worktrees (as the tmpdir spells them) and folders inside them
assert.ok((await a.req('git.status')).ok, 'no repoPath: the open repository')
const wtPorcelain = await a.req('git.porcelain', { repoPath: wt })
assert.ok(wtPorcelain.ok, `a linked worktree: ${wtPorcelain.error?.message}`)
mkdirSync(join(repo, 'sub'))
assert.ok((await a.req('git.status', { repoPath: join(repo, 'sub') })).ok, 'a folder inside the repository')
assert.equal(errCode(await a.req('git.status', { repoPath: other })), 'outside_workspace', 'another repository')
assert.equal(errCode(await a.req('git.porcelain', { repoPath: root })), 'outside_workspace', 'the parent folder')
assert.equal(errCode(await a.req('worktree.list', { repoPath: other })), 'outside_workspace', 'every repo() command')
// the selected worktree becomes a sandbox root: only a real worktree of the open repository
assert.equal(errCode(await a.req('workspace.openWorktree', { path: other })), 'outside_workspace', 'openWorktree refuses another repository')
assert.equal(errCode(await a.req('workspace.openWorktree', { path: root })), 'outside_workspace', 'openWorktree refuses a parent folder')
assert.ok((await a.req('workspace.openWorktree', { path: wt })).ok, 'openWorktree accepts a worktree of the open repository')
assert.ok((await a.req('workspace.openWorktree', { path: repo })).ok, 'and the main checkout')

// git.diff / git.file with the repo-relative path git.porcelain returned (absolute still works)
const diffRel = await a.req('git.diff', { repoPath: repo, file: 'tracked.txt' })
assert.ok(diffRel.ok, `git.diff relative: ${diffRel.error?.message}`)
assert.match(diffRel.data, /^\+v2$/m)
const diffAbs = await a.req('git.diff', { repoPath: repo, file: join(repo, 'tracked.txt') })
assert.ok(diffAbs.ok && /^\+v2$/m.test(diffAbs.data), 'git.diff absolute')
assert.equal(errCode(await a.req('git.diff', { repoPath: repo, file: '../victim.txt' })), 'outside_workspace')
assert.equal((await a.req('git.file', { repoPath: repo, file: 'tracked.txt' })).data?.content, 'v1\n', 'git.file relative')
assert.equal((await a.req('git.file', { repoPath: repo, file: join(repo, 'tracked.txt') })).data?.content, 'v1\n', 'git.file absolute')
// a ref git would read as an option (--output writes a file) is refused before git runs
const injected = join(root, 'injected.txt')
assert.equal(errCode(await a.req('git.file', { repoPath: repo, file: 'tracked.txt', ref: `--output=${injected}` })), 'invalid_args')
assert.ok(!existsSync(injected), 'git show never ran')
assert.equal((await a.req('git.file', { repoPath: repo, file: 'tracked.txt', ref: 'HEAD' })).data?.content, 'v1\n', 'git.file with a ref')

// the app still sends 'auth' after pairing (needed by older bridges): it keeps working
assert.ok((await a.req('auth', { token: tokenA })).ok, 'auth after pair')

// ── scope change: pushed as device.changed and enforced on the next command ──
const granted = registry.updateScopes(deviceA.id, ['view', 'git', 'sql'])!
server.notifyDevice(granted) // what RemoteService.updateScopes does
await until(() => a.events.some((e) => e.topic === 'device.changed'), 'device.changed')
assert.deepEqual(a.events.find((e) => e.topic === 'device.changed')?.data.scopes, ['view', 'git', 'sql'])
assert.ok((await a.req('git.stage', { repoPath: repo, files: ['tracked.txt'] })).ok, 'git granted on the open socket')
assert.ok((await a.req('git.unstage', { repoPath: repo, files: ['tracked.txt'] })).ok)
// the live check reads the registry even when nothing is pushed
registry.updateScopes(deviceA.id, ['view', 'sql'])
assert.equal(errCode(await a.req('git.stage', { repoPath: repo, files: ['tracked.txt'] })), 'forbidden', 'git withdrawn on the open socket')

// git.discard: a path outside the workspace is refused before any confirmation prompt
registry.updateScopes(deviceA.id, ['view', 'git', 'sql'])
assert.equal(errCode(await a.req('git.discard', { repoPath: repo, file: '../victim.txt', untracked: true })), 'outside_workspace')
assert.ok(existsSync(join(root, 'victim.txt')), 'victim.txt untouched')

// worktree.remove: once confirmed, removeSafe refuses a worktree that would lose work, nothing touched
writeFileSync(join(wt, 'wip.txt'), 'wip\n')
const dirty = await confirmed(a, 'worktree.remove', { repoPath: repo, worktreePath: wt })
assert.ok(dirty.ok, `worktree.remove answered: ${dirty.error?.message}`)
assert.equal(dirty.data.ok, false)
assert.equal(dirty.data.skipped, true)
assert.match(dirty.data.error, /modifiche non committate/)
assert.ok(existsSync(join(wt, 'wip.txt')), 'the dirty worktree is kept')
rmSync(join(wt, 'wip.txt'))
const unpushed = await confirmed(a, 'worktree.remove', { repoPath: repo, worktreePath: wt })
assert.equal(unpushed.data?.skipped, true)
assert.match(unpushed.data.error, /commit non pushati/)
assert.ok(existsSync(join(wt, 'tracked.txt')), 'a worktree with unpushed commits is kept')

// ── sql.query: database → USE [db] prepended (] escaped), maxRows clamped ──
assert.ok((await a.req('sql.query', { connectionId: 'c1', query: 'SELECT 1', database: 'Sa]es', maxRows: 50000 })).ok)
assert.deepEqual(sqlCalls.at(-1), { connectionId: 'c1', query: 'USE [Sa]]es];\nSELECT 1', maxRows: 10000, database: 'Sa]es' })
await a.req('sql.query', { connectionId: 'c1', query: 'SELECT 2', maxRows: 5 })
assert.deepEqual(sqlCalls.at(-1), { connectionId: 'c1', query: 'SELECT 2', maxRows: 5, database: undefined }, 'no database: query untouched')
await a.req('sql.query', { connectionId: 'c1', query: 'SELECT 3' })
assert.equal(sqlCalls.at(-1)?.maxRows, 10000, 'default cap')
const calls = sqlCalls.length
assert.equal(errCode(await a.req('sql.query', { connectionId: 'c1', query: 'DELETE FROM T', database: 'Sales' })), 'confirmation_required', 'mutation check on the query, not the USE')
assert.equal(sqlCalls.length, calls)
assert.match(sqlQueryIds.at(-1)!, /^remote_[0-9a-f]{12}$/, 'no queryId: generated')

// ── sql.cancel reaches the query: the bridge runs it under the id the app chose ──
await a.req('sql.query', { connectionId: 'c1', query: 'SELECT 4', queryId: 'remote_lx2k9a-b_1' })
assert.equal(sqlQueryIds.at(-1), 'remote_lx2k9a-b_1', 'the app queryId is used')
assert.ok((await a.req('sql.cancel', { queryId: 'remote_lx2k9a-b_1' })).ok)
assert.deepEqual(sqlCanceled, ['remote_lx2k9a-b_1'])
for (const bad of ['desktop_1', 'remote_', 'remote_a b', `remote_${'x'.repeat(65)}`, 42]) {
  await a.req('sql.query', { connectionId: 'c1', query: 'SELECT 5', queryId: bad })
  assert.match(sqlQueryIds.at(-1)!, /^remote_[0-9a-f]{12}$/, `malformed queryId ${bad}: generated`)
}

// ── revoke from the desktop (RemoteService.revokeDevice): every socket of the device gets 4401 ──
const a2 = await phone()
assert.ok((await a2.req('auth', { token: tokenA })).ok)
registry.revoke(deviceA.id)
server.disconnectDevice(deviceA.id)
await until(() => a.closeCode() !== null && a2.closeCode() !== null, 'revoked sockets to close')
assert.equal(a.closeCode(), 4401)
assert.equal(a2.closeCode(), 4401)

// a revocation that bypassed the push is caught by the next command: error first, then 4401
const b = registry.add({ name: 'Tablet', platform: 'android' })
const pb = await phone()
assert.ok((await pb.req('auth', { token: b.token })).ok)
registry.revoke(b.device.id)
assert.equal(errCode(await pb.req('system.ping')), 'unauthorized')
await until(() => pb.closeCode() !== null, 'revoked socket to close')
assert.equal(pb.closeCode(), 4401)

// ── device.forget: the calling device revokes itself ──
const c = registry.add({ name: 'Phone C', platform: 'android' })
const c1 = await phone()
const c2 = await phone()
assert.ok((await c1.req('auth', { token: c.token })).ok)
assert.ok((await c2.req('auth', { token: c.token })).ok)
const changesBefore = deviceChanges
assert.ok((await c1.req('device.forget')).ok, 'device.forget')
assert.equal(registry.get(c.device.id), null, 'revoked in the registry')
assert.equal(deviceChanges, changesBefore + 1, 'the desktop list refreshes')
// every socket of the device gets 4401, the caller's too once it has its answer
await until(() => c1.closeCode() !== null && c2.closeCode() !== null, 'the sockets of the device to close')
assert.equal(c1.closeCode(), 4401)
assert.equal(c2.closeCode(), 4401)
const c3 = await phone()
assert.equal(errCode(await c3.req('auth', { token: c.token })), 'unauthorized', 'the token is gone')

// ── stop() resolves while a phone is connected and one is waiting on a pairing ──
const d = registry.add({ name: 'Phone D', platform: 'android' })
const pd = await phone()
assert.ok((await pd.req('auth', { token: d.token })).ok)
const pe = await phone()
void pe.req('pair', { token: pairing.begin().token, name: 'Phone E', platform: 'android' })
await until(() => pe.events.some((e) => e.topic === 'pairing.pending'), 'second pairing.pending')
const started = Date.now()
const stopped = await Promise.race([server.stop().then(() => true), sleep(2000).then(() => false)])
const stopMs = Date.now() - started
assert.ok(stopped, 'stop() resolved within 2 s')
await until(() => pd.closeCode() !== null && pe.closeCode() !== null && c3.closeCode() !== null, 'clients cut off by stop()')
assert.equal(server.listening, false)
assert.deepEqual(server.listPending(), [])

rmSync(root, { recursive: true, force: true })
console.log(`ok — remote bridge (stop in ${stopMs} ms)`)
