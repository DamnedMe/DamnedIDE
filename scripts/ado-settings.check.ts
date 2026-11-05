// Self-check for the Azure DevOps settings: the pure helpers (src/shared/adoSettings.ts)
// and the main-process store (electron/services/ado/ado-settings.store.ts) with a fake
// keystore in a temp dir. Azure DevOps itself is never called.
// Run: node --experimental-strip-types scripts/ado-settings.check.ts
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  folderKey, mainFolderPath, folderName, emptyAdoSettings, sanitizeAdoSettings, resolveFolderRepo,
  migrateLegacyAdo, releaseRepos, siblingRepos, withBeRepo, parseAdoUrl
} from '../src/shared/adoSettings.ts'
import type { AdoConnectionConfig, AdoRepoList } from '../src/shared/adoSettings.ts'
import { promotionConfigKey } from '../src/shared/adoPromotion.ts'

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
const { AdoSettingsStore } = await import('../electron/services/ado/ado-settings.store.ts')

// ── folderKey / mainFolderPath / folderName ───────────────────────────────
assert.equal(folderKey('C:\\Source\\Repos\\Themis-API\\'), 'c:/source/repos/themis-api')
assert.equal(folderKey('c:/source/repos/themis-api'), folderKey('C:\\Source\\Repos\\Themis-API'), 'one key per folder')
assert.equal(mainFolderPath('C:/Source/Repos/Themis-API', 'C:/Source/Repos/Themis-API/.git'), 'C:/Source/Repos/Themis-API', 'main checkout')
assert.equal(
  mainFolderPath('C:/Source/Repos/Themis-API/.worktrees/feature/5444', 'C:/Source/Repos/Themis-API/.git'),
  'C:/Source/Repos/Themis-API', 'a linked worktree resolves to the main repository'
)
assert.equal(mainFolderPath('C:/wt/5444', 'C:\\Source\\Repos\\Themis-API\\.git\\'), 'C:/Source/Repos/Themis-API', 'backslashes and trailing separator')
assert.equal(mainFolderPath('/home/me/api', '/home/me/api/.git'), '/home/me/api', 'posix path')
assert.equal(mainFolderPath('C:/x', null), 'C:/x', 'unknown common dir')
assert.equal(mainFolderPath('C:/x', '.git'), 'C:/x', 'relative common dir')
assert.equal(mainFolderPath('C:/x', 'C:/bare/x.git'), 'C:/x', 'bare repository')
assert.equal(mainFolderPath('C:/x/sub', 'C:/x/.git/modules/sub'), 'C:/x/sub', 'submodule')
assert.equal(folderName('C:\\Source\\Repos\\Themis-API\\'), 'Themis-API')
assert.equal(folderName('/home/me/api'), 'api')

// ── parseAdoUrl (a URL pasted in the organization field) ──────────────────
assert.deepEqual(parseAdoUrl('https://dev.azure.com/contoso/Themis/_git/X'), { organization: 'contoso', project: 'Themis' })
assert.deepEqual(
  parseAdoUrl(' https://contoso.visualstudio.com/DefaultCollection/My%20Proj'), { organization: 'contoso', project: 'My Proj' },
  'old host, DefaultCollection skipped, decoded'
)
assert.deepEqual(parseAdoUrl('https://contoso.visualstudio.com/Themis/_git/X'), { organization: 'contoso', project: 'Themis' })
assert.deepEqual(parseAdoUrl('https://dev.azure.com/contoso/_settings'), { organization: 'contoso', project: undefined }, "'_' segments are not projects")
assert.deepEqual(parseAdoUrl('https://dev.azure.com/contoso'), { organization: 'contoso', project: undefined })
assert.equal(parseAdoUrl('contoso'), null, 'a plain name is not a URL')
assert.equal(parseAdoUrl('https://github.com/contoso/x'), null)

// ── sanitizeAdoSettings ───────────────────────────────────────────────────
assert.deepEqual(sanitizeAdoSettings(null), emptyAdoSettings())
assert.deepEqual(sanitizeAdoSettings('{ broken'), emptyAdoSettings())
const sanitized = sanitizeAdoSettings({
  connections: [
    { id: 'c1', organization: ' contoso ', project: 'Themis' },
    { id: 'c1', organization: 'dup', project: 'dup' },
    { id: '', organization: 'x', project: 'y' },
    { id: 'c2', organization: 'contoso' },
    'junk'
  ],
  folders: {
    'C:\\Repos\\API': { connectionId: 'c1', repository: ' Themis-API ' },
    'c:/repos/orphan': { connectionId: 'gone', repository: 'X' },
    'c:/repos/empty': { connectionId: 'c1', repository: '' }
  },
  release: {
    'contoso/themis': { beRepo: 'Themis-API', feRepo: '', branches: { 'Themis-API': { qa: ' test ', prod: '', bogus: 'x' }, Empty: {} }, extra: 1 },
    'contoso/empty': { nothing: true }
  }
})
assert.deepEqual(sanitized.connections, [{ id: 'c1', organization: 'contoso', project: 'Themis' }], 'first id wins, incomplete dropped')
assert.deepEqual(sanitized.folders, { 'c:/repos/api': { connectionId: 'c1', repository: 'Themis-API' } }, 'orphan and empty mappings dropped')
assert.deepEqual(sanitized.release, {
  'contoso/themis': { beRepo: 'Themis-API', feRepo: '', branches: { 'Themis-API': { qa: 'test' } } }
}, "'' (no FE) is kept, empty branch names and configs dropped")

// ── resolveFolderRepo ─────────────────────────────────────────────────────
const c1: AdoConnectionConfig = { id: 'c1', organization: 'contoso', project: 'Themis' }
const c2: AdoConnectionConfig = { id: 'c2', organization: 'fabrikam', project: 'Portal' }
const catalog: Record<string, AdoRepoList> = {
  c1: { ok: true, repos: ['Themis-API', 'Themis-Frontend'] },
  c2: { ok: true, repos: ['Portal', 'themis-api'] }
}
assert.deepEqual(resolveFolderRepo('Themis-API', undefined, [], catalog), { status: 'no-connections' })
assert.deepEqual(
  resolveFolderRepo('Themis-API', { connectionId: 'c2', repository: 'Portal' }, [c1, c2], {}),
  { status: 'saved', ref: { connectionId: 'c2', repository: 'Portal' } }, 'saved mapping wins, no catalog needed'
)
assert.deepEqual(
  resolveFolderRepo('themis-frontend', { connectionId: 'removed', repository: 'X' }, [c1, c2], catalog),
  { status: 'auto', ref: { connectionId: 'c1', repository: 'Themis-Frontend' } },
  'a mapping to a removed connection is ignored; unique same name (case-insensitive, ADO spelling)'
)
assert.deepEqual(
  resolveFolderRepo('Themis-API', undefined, [c1, c2], catalog),
  { status: 'ambiguous', candidates: [{ connectionId: 'c1', repository: 'Themis-API' }, { connectionId: 'c2', repository: 'themis-api' }] },
  'same name on two connections'
)
const none = resolveFolderRepo('Other', undefined, [c1, c2], catalog)
assert.equal(none.status, 'none')
assert.equal(none.status === 'none' && none.candidates.length, 4, 'none: every repository is a candidate')
assert.deepEqual(
  resolveFolderRepo('Themis-API', undefined, [c1, c2], { c1: catalog.c1, c2: { ok: false, error: 'PAT scaduto' } }),
  { status: 'auto', ref: { connectionId: 'c1', repository: 'Themis-API' } },
  'a failed catalog contributes nothing: auto for the session only, the caller must not save it (useAdoFolder)'
)
assert.deepEqual(
  resolveFolderRepo('Themis-API', undefined, [c1], { c1: { ok: false, error: 'x' } }),
  { status: 'none', candidates: [] }, 'every catalog failed'
)

// ── migrateLegacyAdo ──────────────────────────────────────────────────────
let n = 0
const migrated = migrateLegacyAdo({
  'C:\\Source\\Repos\\Themis-API': { organization: 'Contoso', project: 'Themis', repository: 'Themis-API', token: '' },
  'c:/source/repos/themis-frontend': { organization: ' contoso', project: 'themis ', repository: 'Themis-Frontend', token: 'pat-fe' },
  'c:/source/repos/other': { organization: 'contoso', project: 'Themis', repository: 'Other', token: 'pat-late' },
  'c:/source/repos/broken': { organization: 'contoso' },
  '': { organization: 'fabrikam', project: 'Portal', repository: 'Portal', token: 'pat-global' }
}, { 'contoso/themis': { feRepo: 'Themis-Frontend' } }, () => `id${++n}`)
assert.deepEqual(migrated.settings.connections, [
  { id: 'id1', organization: 'Contoso', project: 'Themis' },
  { id: 'id2', organization: 'fabrikam', project: 'Portal' }
], 'deduped by promotionConfigKey, first spelling kept')
assert.equal(promotionConfigKey(' contoso', 'themis '), promotionConfigKey('Contoso', 'Themis'), 'same dedupe rule as the release key')
assert.deepEqual(migrated.tokens, { id1: 'pat-fe', id2: 'pat-global' }, 'first non-empty PAT wins')
assert.deepEqual(migrated.settings.folders, {
  'c:/source/repos/themis-api': { connectionId: 'id1', repository: 'Themis-API' },
  'c:/source/repos/themis-frontend': { connectionId: 'id1', repository: 'Themis-Frontend' },
  'c:/source/repos/other': { connectionId: 'id1', repository: 'Other' }
}, "the global connection ('') maps no folder")
assert.deepEqual(migrated.settings.release, { 'contoso/themis': { feRepo: 'Themis-Frontend' } })

// ── releaseRepos / siblingRepos ───────────────────────────────────────────
const folders = {
  'c:/repos/api': { connectionId: 'c1', repository: 'Themis-API' },
  'c:/repos/fe': { connectionId: 'c1', repository: 'Themis-Frontend' },
  'c:/repos/fe2': { connectionId: 'c1', repository: 'themis-frontend' },
  'c:/repos/portal': { connectionId: 'c2', repository: 'Portal' }
}
assert.deepEqual(siblingRepos(folders, 'c1', 'c:/repos/api'), ['Themis-Frontend'], 'other folders of the connection, deduped')
assert.deepEqual(releaseRepos(undefined, 'Themis-API', ['Themis-Frontend']), { be: 'Themis-API', fe: 'Themis-Frontend' }, 'defaults')
assert.deepEqual(releaseRepos({ beRepo: 'Core', feRepo: 'Web' }, 'Themis-API', ['Themis-Frontend']), { be: 'Core', fe: 'Web' }, 'saved choices')
assert.deepEqual(releaseRepos({ beRepo: 'Themis-Frontend', feRepo: 'themis-frontend' }, 'Themis-API', ['Themis-API', 'Admin']), { be: 'Themis-Frontend', fe: 'Themis-API' }, 'FE never equals BE')
assert.deepEqual(releaseRepos({ feRepo: '' }, 'Themis-API', ['Themis-Frontend']), { be: 'Themis-API', fe: '' }, "'' = no FE")
assert.deepEqual(releaseRepos(undefined, null, []), { be: '', fe: '' })

// ── withBeRepo (the one BE rule of the Release panel and Settings › Rilascio) ──
const overrides = { 'Themis-API': { qa: 'test' } }
const beforeBe = { feRepo: 'Themis-API', branches: overrides }
assert.deepEqual(withBeRepo(beforeBe, 'themis-api'), { beRepo: 'themis-api', branches: overrides }, 'a saved FE that becomes the BE goes back to automatic')
assert.deepEqual(beforeBe, { feRepo: 'Themis-API', branches: overrides }, 'the input is not changed')
assert.deepEqual(withBeRepo({ feRepo: 'Web' }, 'Core'), { feRepo: 'Web', beRepo: 'Core' }, 'another FE stays')
assert.deepEqual(withBeRepo({ beRepo: 'Core', feRepo: '' }, undefined), { feRepo: '' }, 'undefined = the folder repository again')
assert.deepEqual(withBeRepo(undefined, 'Core'), { beRepo: 'Core' })

// ── AdoSettingsStore ──────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'damned-ado-settings-'))
let encryption = true
const box = {
  available: () => encryption,
  encrypt: (plain: string) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
  decrypt: (data: Buffer) => {
    const s = data.toString()
    if (!s.startsWith('enc:')) throw new Error('not ours')
    return [...s.slice(4)].reverse().join('')
  }
}
try {
  const a = new AdoSettingsStore(dir, box)
  const b = new AdoSettingsStore(dir, box) // a second IDE instance on the same profile
  assert.deepEqual(a.read(), emptyAdoSettings(), 'no file yet')

  // two instances do not lose each other's writes
  const ca = a.saveConnection({ organization: ' contoso ', project: 'Themis', token: ' pat-themis-1 ' })
  const cb = b.saveConnection({ organization: 'fabrikam', project: 'Portal', token: 'pat-portal-2' })
  assert.equal(ca.organization, 'contoso', 'trimmed')
  assert.deepEqual(a.read().connections.map(c => c.id), [ca.id, cb.id], 'b kept what a saved')
  a.setFolder('C:\\Repos\\API', { connectionId: ca.id, repository: 'Themis-API' })
  b.setFolder('c:/repos/portal/', { connectionId: cb.id, repository: 'Portal' })
  a.setRelease(promotionConfigKey('contoso', 'Themis'), { beRepo: 'Themis-API', feRepo: 'Themis-Frontend' })
  b.setRelease('fabrikam/portal', { feRepo: '' })
  const both = a.read()
  assert.deepEqual(Object.keys(both.folders).sort(), ['c:/repos/api', 'c:/repos/portal'])
  assert.deepEqual(Object.keys(both.release).sort(), ['contoso/themis', 'fabrikam/portal'])
  assert.equal(b.token(ca.id), 'pat-themis-1', 'b reads the PAT a saved')

  // the PATs never reach the renderer view nor the files in plaintext
  const view = a.view()
  assert.deepEqual(view.tokens, { [ca.id]: true, [cb.id]: true })
  for (const text of [JSON.stringify(view), readFileSync(join(dir, 'ado-settings.json'), 'utf8'), readFileSync(join(dir, 'ado-tokens.json'), 'utf8')]) {
    assert.ok(!text.includes('pat-themis-1') && !text.includes('pat-portal-2'), 'no plaintext PAT')
  }

  // edit without a token keeps the PAT; the release choices follow a project rename
  const renamed = b.saveConnection({ id: ca.id, organization: 'contoso', project: 'Themis2' })
  assert.equal(renamed.id, ca.id)
  assert.equal(a.token(ca.id), 'pat-themis-1', 'PAT kept')
  assert.ok(a.read().release['contoso/themis2'] && !a.read().release['contoso/themis'], 'release moved with the rename')
  a.saveConnection({ id: ca.id, organization: 'contoso', project: 'Themis2', token: 'pat-new-3' })
  assert.equal(b.token(ca.id), 'pat-new-3', 'PAT replaced')

  // refusals
  assert.throws(() => a.saveConnection({ organization: 'acme', project: 'X' }), /PAT è obbligatorio/)
  assert.throws(() => a.saveConnection({ organization: 'FABRIKAM ', project: 'portal', token: 't' }), /connessione già presente: FABRIKAM\/portal/)
  assert.throws(() => a.saveConnection({ id: 'nope', organization: 'acme', project: 'X' }), /non trovata/)
  assert.throws(() => a.setFolder('c:/repos/x', { connectionId: 'nope', repository: 'X' }), /non trovata/)
  encryption = false
  assert.throws(() => a.saveConnection({ organization: 'acme', project: 'X', token: 't' }), /cifratura di sistema non disponibile/)
  assert.equal(a.read().connections.length, 2, 'nothing saved without encryption')
  encryption = true

  // setFolder / setRelease null forget
  b.setFolder('c:/repos/portal', null)
  b.setRelease('fabrikam/portal', null)
  assert.deepEqual(Object.keys(a.read().folders), ['c:/repos/api'])
  assert.deepEqual(Object.keys(a.read().release), ['contoso/themis2'])

  // remove drops its folder mappings and its PAT
  a.setFolder('c:/repos/portal', { connectionId: cb.id, repository: 'Portal' })
  b.removeConnection(cb.id)
  assert.deepEqual(a.read().connections.map(c => c.id), [ca.id])
  assert.deepEqual(Object.keys(a.read().folders), ['c:/repos/api'])
  assert.equal(a.token(cb.id), null, 'PAT removed')
  assert.ok(!readFileSync(join(dir, 'ado-tokens.json'), 'utf8').includes(cb.id))

  // importLegacy: only into empty settings
  const legacy = {
    'C:\\Repos\\API': { organization: 'contoso', project: 'Themis', repository: 'Themis-API', token: 'pat-legacy' },
    'c:/repos/fe': { organization: 'Contoso', project: 'themis', repository: 'Themis-Frontend', token: 'pat-other' }
  }
  assert.equal(a.importLegacy(legacy, {}), false, 'settings already have a connection')
  const fresh = mkdtempSync(join(tmpdir(), 'damned-ado-import-'))
  try {
    const s1 = new AdoSettingsStore(fresh, box)
    const s2 = new AdoSettingsStore(fresh, box)
    assert.equal(s1.importLegacy(legacy, { 'contoso/themis': { feRepo: 'Themis-Frontend' } }), true)
    assert.equal(s2.importLegacy(legacy, {}), false, 'another instance migrated already')
    const imported = s2.read()
    assert.equal(imported.connections.length, 1, 'deduped')
    const id = imported.connections[0].id
    assert.equal(s2.token(id), 'pat-legacy', 'first non-empty PAT, encrypted')
    assert.deepEqual(imported.folders, {
      'c:/repos/api': { connectionId: id, repository: 'Themis-API' },
      'c:/repos/fe': { connectionId: id, repository: 'Themis-Frontend' }
    })
    assert.deepEqual(imported.release, { 'contoso/themis': { feRepo: 'Themis-Frontend' } })
    assert.ok(!readFileSync(join(fresh, 'ado-tokens.json'), 'utf8').includes('pat-legacy'))
    assert.equal(new AdoSettingsStore(mkdtempSync(join(fresh, 'empty-')), box).importLegacy({}, {}), false, 'nothing to import')
    // the loser of a race (it saw no connection, another instance claimed the settings first) never touches the PATs
    const tokensBefore = readFileSync(join(fresh, 'ado-tokens.json'), 'utf8')
    const loser = new AdoSettingsStore(fresh, box)
    loser.read = () => emptyAdoSettings()
    assert.equal(loser.importLegacy({ 'c:/repos/x': { organization: 'fabrikam', project: 'Portal', repository: 'X', token: 'pat-loser' } }, {}), false)
    assert.equal(readFileSync(join(fresh, 'ado-tokens.json'), 'utf8'), tokensBefore, "the winner's PATs are kept")
    assert.equal(s2.token(id), 'pat-legacy')
  } finally {
    rmSync(fresh, { recursive: true, force: true })
  }

  // a PAT the keystore cannot decrypt (keystore changed, profile moved) shows as missing
  const settingsFile = join(dir, 'ado-settings.json')
  const tokensFile = join(dir, 'ado-tokens.json')
  const savedTokens = readFileSync(tokensFile, 'utf8')
  writeFileSync(tokensFile, JSON.stringify({ [ca.id]: Buffer.from('foreign').toString('base64') }))
  assert.equal(a.token(ca.id), null)
  assert.deepEqual(a.view().tokens, { [ca.id]: false }, 'hasToken only when the PAT decrypts')
  writeFileSync(tokensFile, savedTokens)
  assert.deepEqual(a.view().tokens, { [ca.id]: true })

  // a broken or foreign file never throws on read...
  writeFileSync(tokensFile, '{ broken')
  assert.equal(a.token(ca.id), null)
  assert.deepEqual(a.view().tokens, { [ca.id]: false })
  // ...but no writer replaces it (every other PAT, connection or mapping would be lost)
  assert.throws(() => a.saveConnection({ id: ca.id, organization: 'contoso', project: 'Themis2', token: 'pat-x' }), /ado-tokens\.json non leggibile/)
  assert.throws(() => a.removeConnection(ca.id), /ado-tokens\.json non leggibile/)
  assert.equal(readFileSync(tokensFile, 'utf8'), '{ broken', 'tokens file kept')
  assert.deepEqual(a.read().connections.map(c => c.id), [ca.id], 'nothing removed')
  writeFileSync(tokensFile, savedTokens)
  writeFileSync(settingsFile, 'garbage')
  assert.deepEqual(a.read(), emptyAdoSettings())
  assert.deepEqual(a.view(), { ...emptyAdoSettings(), tokens: {} })
  assert.throws(() => a.setRelease('contoso/themis2', { feRepo: '' }), /ado-settings\.json non leggibile: correggilo o eliminalo/)
  assert.throws(() => a.setFolder('c:/repos/x', null), /ado-settings\.json non leggibile/)
  assert.throws(() => a.saveConnection({ organization: 'acme', project: 'X', token: 't' }), /ado-settings\.json non leggibile/)
  assert.throws(() => a.importLegacy({ 'c:/repos/x': { organization: 'acme', project: 'X', token: 't' } }, {}), /ado-settings\.json non leggibile/)
  assert.equal(readFileSync(settingsFile, 'utf8'), 'garbage', 'settings file kept')
  assert.equal(readFileSync(tokensFile, 'utf8'), savedTokens, 'no PAT written for a refused change')
  // an empty file holds nothing to lose: written normally
  writeFileSync(settingsFile, '')
  a.setRelease('contoso/themis2', { feRepo: '' })
  assert.deepEqual(a.read().release, { 'contoso/themis2': { feRepo: '' } })
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.tmp')), [], 'no temp file left behind')
  console.log('ok — ado-settings')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
