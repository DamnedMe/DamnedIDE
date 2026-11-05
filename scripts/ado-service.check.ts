// Self-check for the Azure DevOps service URLs and the connection check's error
// messages, with globalThis.fetch stubbed: Azure DevOps itself is never called.
// Run: node --experimental-strip-types scripts/ado-service.check.ts
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

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
const { AdoService, fetchRepositories } = await import('../electron/services/ado/ado.service.ts')

type Reply = Response | Error
const calls: { url: string; auth: string }[] = []
let reply: () => Reply = () => new Response('{}')
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  calls.push({ url: String(input), auth: headers.get('Authorization') ?? '' })
  const r = reply()
  if (r instanceof Error) throw r
  return r
}) as typeof fetch
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const basic = (pat: string) => `Basic ${Buffer.from(`:${pat}`).toString('base64')}`

// ── getBranches: refs?filter=heads/ (refs/branches matched no ref) ─────────
const service = new AdoService()
service.use('contoso', 'pat-1')
reply = () => json({ value: [{ name: 'refs/heads/develop' }, { name: 'refs/heads/feature/5444' }, { name: 'refs/heads/qa' }] })
assert.deepEqual(await service.getBranches('Themis', 'Themis-API'), ['develop', 'feature/5444', 'qa'])
assert.equal(calls.at(-1)?.url, 'https://dev.azure.com/contoso/Themis/_apis/git/repositories/Themis-API/refs?filter=heads/&api-version=7.0')
assert.equal(calls.at(-1)?.auth, basic('pat-1'))
reply = () => new Response('', { status: 404 })
assert.deepEqual(await service.getBranches('Themis', 'Missing'), [], 'unknown repository: no branches')

// use() points the following calls at another org/PAT
service.use('fabrikam', 'pat-2')
reply = () => json({ value: [] })
await service.getBranches('Portal', 'Portal')
assert.ok(calls.at(-1)?.url.startsWith('https://dev.azure.com/fabrikam/Portal/'))
assert.equal(calls.at(-1)?.auth, basic('pat-2'))

// ── fetchRepositories ────────────────────────────────────────────────────
reply = () => json({ value: [{ name: 'themis-frontend' }, { name: 'Themis-API' }, { name: '' }, {}] })
assert.deepEqual(await fetchRepositories(' my org ', 'Themis Project', 'pat-3'), { ok: true, repos: ['Themis-API', 'themis-frontend'] }, 'names, sorted')
assert.equal(calls.at(-1)?.url, 'https://dev.azure.com/my%20org/Themis%20Project/_apis/git/repositories?api-version=7.0', 'trimmed and encoded')
assert.equal(calls.at(-1)?.auth, basic('pat-3'))
service.use('contoso', 'pat-1')
const before = calls.length
await fetchRepositories('other', 'P', 'pat-x')
reply = () => json({ value: [] })
await service.getBranches('Themis', 'Themis-API')
assert.equal(calls.at(-1)?.auth, basic('pat-1'), 'fetchRepositories never touches the service connection')
assert.equal(calls.length, before + 2)

const errorFor = async (r: () => Reply) => {
  reply = r
  const res = await fetchRepositories('contoso', 'Themis', 'pat')
  assert.equal(res.ok, false)
  return res.ok ? '' : res.error
}
assert.equal(await errorFor(() => new Response('', { status: 401 })), 'PAT non valido, scaduto o senza permesso Code (Read)')
assert.equal(await errorFor(() => new Response('', { status: 403 })), 'PAT non valido, scaduto o senza permesso Code (Read)')
assert.equal(await errorFor(() => new Response('', { status: 404 })), 'organization o project non trovati: contoso/Themis')
assert.equal(await errorFor(() => new Response('<html>sign in</html>', { status: 203 })), 'PAT non valido o scaduto', '203 + sign-in page')
assert.equal(await errorFor(() => new Response('<html>sign in</html>', { status: 200 })), 'PAT non valido o scaduto', 'sign-in page after a redirect')
assert.equal(await errorFor(() => json({ unexpected: true })), 'PAT non valido o scaduto', 'not a repository list')
assert.equal(await errorFor(() => new Response('', { status: 500 })), 'errore Azure DevOps 500')
assert.equal(
  await errorFor(() => Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND dev.azure.com') })),
  'Azure DevOps non raggiungibile: getaddrinfo ENOTFOUND dev.azure.com'
)
assert.equal(await errorFor(() => new Error('offline')), 'Azure DevOps non raggiungibile: offline')
console.log('ok — ado-service')
