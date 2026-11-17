// Self-check for the release over the DamnedCloud bridge: ReleaseService
// (electron/services/ado/release.service.ts) with a fake Azure DevOps, store and chain service,
// then the release.* commands of RemoteCommands (scopes, confirmation). Azure DevOps is never called.
// Run: node --experimental-strip-types scripts/release-remote.check.ts
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

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
  // constructor parameter properties (RemoteCommands) and type-only value imports need a real transpile
  load(url, context, next) {
    if (!/\/electron\/.*\.ts$/.test(url)) return next(url, context)
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf-8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
})
const { ReleaseService } = await import('../electron/services/ado/release.service.ts')
const { RemoteCommands } = await import('../electron/services/remote/commands.ts')
const { PairingService } = await import('../electron/services/remote/auth/pairing.ts')
const { WorkspaceState } = await import('../electron/services/remote/workspace-state.ts')

const repo = mkdtempSync(join(tmpdir(), 'damned-release-'))
const conn = { id: 'c1', organization: 'Contoso', project: 'Themis' }
const key = repo.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

// ── fakes ──
let settings: any = {
  connections: [conn],
  folders: { [key]: { connectionId: 'c1', repository: 'Themis-API' }, 'c:/x/fe': { connectionId: 'c1', repository: 'Themis-Frontend' } },
  release: {}
}
const saved: { key: string; config: any }[] = []
let changes = 0
const store = {
  read: () => settings,
  token: (id: string) => (id === 'c1' ? 'pat' : null),
  setRelease: (k: string, config: any) => {
    saved.push({ key: k, config })
    settings = { ...settings, release: { ...settings.release, [k]: config } }
  }
}
const remote: Record<string, { branches: string[]; commits: Record<string, string[]>; prs: { id: number; sourceBranch: string; targetBranch: string; url: string }[] }> = {
  'Themis-API': {
    branches: ['develop', 'qa', 'main', 'feature/x'],
    commits: { 'develop>qa': ['Merged PR 1: #5444 fornitore', 'fix #5445'], 'qa>main': ['hotfix'] },
    prs: []
  },
  'Themis-Frontend': {
    branches: ['develop', 'test', 'master'],
    commits: { 'develop>test': [], 'test>master': ['release fe', '#7000'] },
    prs: []
  }
}
const created: { repo: string; opts: any }[] = []
let createMode: 'autocomplete' | 'open' = 'open'
const ado = {
  use: () => {},
  getBranches: async (_p: string, r: string) => remote[r]?.branches ?? [],
  getCommitsBetween: async (_p: string, r: string, s: string, t: string) =>
    (remote[r].commits[`${s}>${t}`] ?? []).map((message, i) => ({ commitId: `${r}${i}`.padEnd(8, '0'), message, author: 'dev' })),
  getWorkItemsBatch: async (_p: string, ids: number[]) => ids.map(id => ({ id, title: `wi ${id}`, type: 'Task', state: 'Done', assignedTo: '', url: '' })),
  getPullRequests: async (_p: string, r: string) => remote[r].prs as any[],
  createPullRequest: async (_p: string, r: string, opts: any) => {
    created.push({ repo: r, opts })
    return { id: 900 + created.length, title: opts.title, mode: createMode, url: `https://x/${900 + created.length}` }
  }
}
let chainList: any[] = []
const started: any[] = []
const chains = {
  list: () => chainList,
  start: (input: any, c: any) => {
    started.push(input)
    const chain = { id: 'k1', connectionId: c.id, organization: c.organization, project: c.project, autoComplete: input.autoComplete, createdAt: 1, items: [] }
    return chain
  },
  cancel: () => {},
  remove: () => {}
}
const release = new ReleaseService({
  settings: store,
  repositories: async () => ({ ok: true, repos: ['Themis-API', 'Themis-Frontend', 'Other'] }),
  chains: chains as any,
  gitCommonDir: async (p: string) => `${p}/.git`,
  createAdo: () => ado as any,
  changed: () => void changes++
})

// ── state: the folder's saved repository is the BE, the sibling folder's the FE ──
{
  const s = await release.state(repo)
  assert.equal(s.unavailable, undefined)
  assert.deepEqual([s.organization, s.project, s.folderRepo, s.be, s.fe, s.stage], ['Contoso', 'Themis', 'Themis-API', 'Themis-API', 'Themis-Frontend', 'dev-qa'])
  assert.deepEqual(s.repos, ['Themis-API', 'Themis-Frontend', 'Other'])
}
{
  const empty = new ReleaseService({ settings: { ...store, read: () => ({ connections: [], folders: {}, release: {} }) }, repositories: async () => ({ ok: true, repos: [] }), chains: chains as any, gitCommonDir: async () => '' })
  assert.match((await empty.state(repo)).unavailable ?? '', /nessuna connessione Azure DevOps/)
  // no saved mapping, two same-name repositories: the desktop must choose
  const twin = { ...conn, id: 'c2', project: 'Other' }
  const ambiguous = new ReleaseService({
    settings: { ...store, read: () => ({ connections: [conn, twin], folders: {}, release: {} }) },
    repositories: async () => ({ ok: true, repos: [repo.split(/[\\/]/).pop()!] }), chains: chains as any, gitCommonDir: async () => ''
  })
  assert.match((await ambiguous.state(repo)).unavailable ?? '', /non chiara: sceglila sul desktop/)
}

// ── preview develop → qa: branches by role (FE has test), work items from the commits ──
{
  const [be, fe] = await release.preview(repo, 'dev-qa', 'both')
  assert.deepEqual([be.source, be.target, be.commits.length, be.workItems.map(w => w.id), be.existing], ['develop', 'qa', 2, [5444, 5445], null])
  assert.deepEqual([fe.source, fe.target, fe.commits.length], ['develop', 'test', 0])
  await assert.rejects(() => release.preview(repo, 'prod', 'be'), /fase di rilascio non valida/)
  await assert.rejects(() => release.preview(repo, 'dev-qa', 'all'), /ambito di rilascio non valido/)
  // an active promotion PR is reported (and keeps the repository out of release.create)
  remote['Themis-API'].prs = [{ id: 77, sourceBranch: 'develop', targetBranch: 'qa', url: '' }]
  const [withPr] = await release.preview(repo, 'dev-qa', 'be')
  assert.deepEqual(withPr.existing, { id: 77, url: 'https://dev.azure.com/Contoso/Themis/_git/Themis-API/pullrequest/77' })
  await assert.rejects(() => release.plan(false, repo, { stage: 'dev-qa', scope: 'be', autoComplete: false }), /nulla da rilasciare/)
  remote['Themis-API'].prs = []
}

// ── a branch the role names cannot find: picked by hand, saved per project ──
{
  remote['Themis-API'].branches = ['develop', 'collaudo', 'main']
  const [missing] = await release.preview(repo, 'dev-qa', 'be')
  assert.deepEqual([missing.source, missing.target, missing.commits.length], ['develop', null, 0])
  remote['Themis-API'].commits['develop>collaudo'] = ['#1']
  const s = await release.setConfig(repo, { branch: { repo: 'Themis-API', role: 'qa', name: 'collaudo' } })
  assert.equal(changes, 1, 'the desktop panel and the phones are told')
  assert.deepEqual(saved.at(-1), { key: 'contoso/themis', config: { branches: { 'Themis-API': { qa: 'collaudo' } } } })
  assert.equal(s.be, 'Themis-API')
  const [picked] = await release.preview(repo, 'dev-qa', 'be')
  assert.deepEqual([picked.target, picked.commits.length], ['collaudo', 1])
  await assert.rejects(() => release.setConfig(repo, { branch: { repo: 'Themis-API', role: 'staging', name: 'x' } }), /branch di rilascio non valido/)
  await assert.rejects(() => release.setConfig(repo, { branch: { repo: 'Other', role: 'qa', name: 'x' } }), /branch di rilascio non valido/,
    'only the BE / FE of the project')
  // the name goes into the Azure DevOps URLs: only a repository of the project
  await assert.rejects(() => release.setConfig(repo, { beRepo: '../../_apis/projects' }), /non trovata in Contoso\/Themis/)
  assert.equal((await release.setConfig(repo, { feRepo: 'themis-frontend' })).fe, 'Themis-Frontend', 'spelled as the project lists it')
  // the panel's rule: a saved FE that becomes the BE goes back to automatic
  await release.setConfig(repo, { feRepo: 'Other' })
  const be = await release.setConfig(repo, { beRepo: 'Other' })
  assert.equal(saved.at(-1)!.config.feRepo, undefined)
  assert.deepEqual([be.be, be.fe], ['Other', 'Themis-Frontend'])
  settings = { ...settings, release: {} }
  remote['Themis-API'].branches = ['develop', 'qa', 'main', 'feature/x']
}

// ── create develop → qa: no confirmation, unticked work items not linked, develop never deleted ──
{
  const plan = await release.plan(false, repo, { stage: 'dev-qa', scope: 'both', autoComplete: true, excluded: ['BE:5445', 7] })
  assert.equal(plan.confirm, undefined, 'develop → qa goes at once, as on the desktop')
  assert.deepEqual(plan.items.map(p => p.side), ['BE'], 'FE has nothing to promote')
  const out = await release.create(plan)
  assert.equal(created.length, 1)
  const { opts } = created[0]
  assert.deepEqual([opts.sourceRef, opts.targetRef, opts.workItemIds, opts.deleteSourceBranch, opts.forceComplete, opts.autoComplete],
    ['develop', 'qa', [5444], false, false, true])
  assert.match(opts.title, /^Release develop → qa · BE · \d{4}-\d\d-\d\d$/)
  assert.match(opts.description, /#5444 wi 5444/)
  assert.doesNotMatch(opts.description, /#5445 wi/)
  assert.deepEqual(out, [{ side: 'BE', repo: 'Themis-API', ok: true, pr: { id: 901, url: 'https://x/901' }, mode: 'open', notArmed: true }])
}

// ── create qa → prod: confirmed first ──
{
  const plan = await release.plan(false, repo, { stage: 'qa-prod', scope: 'both', autoComplete: false })
  assert.deepEqual(plan.items.map(p => `${p.side}:${p.source}>${p.target}`), ['BE:qa>main', 'FE:test>master'])
  assert.match(plan.confirm!.summary, /produzione/)
  assert.match(plan.confirm!.details, /BE · Themis-API: qa → main · 1 commit · 0 work item/)
  assert.match(plan.confirm!.details, /FE · Themis-Frontend: test → master · 2 commit · 1 work item/)
  await assert.rejects(() => release.plan(false, repo, { stage: 'dev-qa-prod', scope: 'be', autoComplete: false }), /release\.chainStart/)
}

// ── chain: BE gets a develop → qa PR, FE has nothing for qa and starts at qa → prod ──
{
  created.length = 0
  createMode = 'open'
  const previews = await release.preview(repo, 'dev-qa-prod', 'both')
  assert.deepEqual(previews.map(p => [p.prod, p.prodCommits, p.prodExisting]), [['main', undefined, undefined], ['master', 2, null]])
  const plan = await release.plan(true, repo, { scope: 'both', autoComplete: true })
  assert.match(plan.confirm!.details, /2\. test → master: PR creata subito · 2 commit/)
  assert.match(plan.confirm!.details, /1\. develop → qa: nuova PR · 2 commit · 2 work item/)
  const res = await release.startChain(plan)
  assert.equal(created.length, 1, 'only BE needs a develop → qa PR')
  assert.deepEqual(started.at(-1), {
    connectionId: 'c1', autoComplete: true, items: [
      { side: 'BE', repo: 'Themis-API', branches: { dev: 'develop', qa: 'qa', prod: 'main' }, qaPr: { id: 901, url: 'https://x/901' }, qaNoAutoComplete: true },
      { side: 'FE', repo: 'Themis-Frontend', branches: { dev: 'develop', qa: 'test', prod: 'master' } }
    ]
  })
  assert.equal(res.chain?.id, 'k1')
  // a repository already followed by a running chain is left out
  chainList = [{ id: 'k1', connectionId: 'c1', organization: 'contoso', project: 'THEMIS', autoComplete: true, createdAt: 1,
    items: [{ side: 'BE', repo: 'themis-api', branches: { dev: 'develop', qa: 'qa', prod: 'main' }, status: 'waiting-qa', updatedAt: 1 }] }]
  const again = await release.plan(true, repo, { scope: 'both', autoComplete: false })
  assert.deepEqual(again.items.map(p => p.side), ['FE'])
  assert.equal((await release.state(repo)).chains.length, 1, 'the project chains, case-insensitive')
  chainList = []
}

// ── over the bridge: scopes and the confirmation of qa → prod ──
{
  const workspace = new WorkspaceState()
  workspace.update({ repoPath: repo })
  const pairing = new PairingService()
  const commands = new RemoteCommands({
    git: {} as never, worktree: { list: async () => [] } as never, diff: {} as never, sql: {} as never, workspace, pairing,
    appVersion: '0', platform: 'check', getSqlConnections: () => [], release
  })
  const viewer = { id: 'v', name: 'v', platform: 'web', scopes: ['view'], createdAt: 0, lastSeen: null } as any
  const owner = { ...viewer, id: 'o', scopes: ['view', 'git'] }
  assert.equal(((await commands.execute('release.state', {}, viewer)) as any).be, 'Themis-API')
  assert.equal(((await commands.execute('release.preview', { stage: 'dev-qa', scope: 'be' }, viewer)) as any[]).length, 1)
  await assert.rejects(() => commands.execute('release.create', { stage: 'dev-qa', scope: 'be', autoComplete: false }, viewer), (e: any) => e.code === 'forbidden')
  await assert.rejects(() => commands.execute('release.setConfig', { feRepo: '' }, viewer), (e: any) => e.code === 'forbidden')
  created.length = 0
  let challenge: any = null
  await assert.rejects(() => commands.execute('release.create', { stage: 'qa-prod', scope: 'be', autoComplete: false }, owner), (e: any) => {
    challenge = e.challenge
    return e.code === 'confirmation_required'
  })
  assert.equal(created.length, 0, 'nothing created before the phone confirms')
  assert.match(challenge.details, /qa → main/)
  const out = await commands.execute('release.create', { stage: 'qa-prod', scope: 'be', autoComplete: false, confirm: challenge.id }, owner) as any[]
  assert.deepEqual([created.length, out[0].ok, created[0].opts.targetRef], [1, true, 'main'])
  // a bridge without the release service says so
  const bare = new RemoteCommands({ git: {} as never, worktree: {} as never, diff: {} as never, sql: {} as never, workspace, pairing, appVersion: '0', platform: 'check', getSqlConnections: () => [] })
  await assert.rejects(() => bare.execute('release.state', {}, viewer), (e: any) => e.code === 'unavailable')
}

rmSync(repo, { recursive: true, force: true })
console.log('release remote check ok')
