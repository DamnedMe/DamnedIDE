// Self-check for the LAN webapp file server (electron/services/remote/transports/web-static.ts).
// Run: node --experimental-strip-types scripts/web-static.check.ts
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveWebApp } from '../electron/services/remote/transports/web-static.ts'

const dir = mkdtempSync(join(tmpdir(), 'damned-web-'))
const root = join(dir, 'cloud-web')
mkdirSync(join(root, 'assets'), { recursive: true })
writeFileSync(join(root, 'index.html'), '<html>app</html>')
writeFileSync(join(root, 'assets', 'app-1.js'), 'js')
writeFileSync(join(dir, 'secret.txt'), 'secret')

let webDir: string | undefined = root
const server = createServer((req, res) => {
  if (serveWebApp(webDir, req, res)) return
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('bridge online')
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as { port: number }).port

// raw path: fetch() would normalize the ../ away before sending it
const get = (path: string, method = 'GET') => new Promise<{ status: number; type: string; cache: string; body: string }>((res, rej) => {
  const req = request({ host: '127.0.0.1', port, path, method }, (r) => {
    let body = ''
    r.on('data', (c) => (body += c)).on('end', () => res({ status: r.statusCode!, type: String(r.headers['content-type']), cache: String(r.headers['cache-control']), body }))
  })
  req.on('error', rej).end()
})

const index = await get('/')
assert.deepEqual([index.status, index.body, index.cache], [200, '<html>app</html>', 'no-cache'])
assert.match(index.type, /^text\/html/)
const asset = await get('/assets/app-1.js?v=1')
assert.deepEqual([asset.body, asset.cache], ['js', 'public, max-age=31536000, immutable'])
assert.match(asset.type, /^text\/javascript/)
assert.equal((await get('/screens/worktrees')).body, '<html>app</html>', 'unknown paths get the app')
for (const path of ['/../secret.txt', '/assets/../../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%5csecret.txt'])
  assert.equal((await get(path)).body, '<html>app</html>', `nothing outside the build: ${path}`)
assert.equal((await get('/', 'HEAD')).body, '')
assert.equal((await get('/', 'POST')).body, 'bridge online', 'only GET/HEAD')
webDir = join(dir, 'missing')
assert.equal((await get('/')).body, 'bridge online', 'no build shipped: the bridge answers as before')

server.close()
rmSync(dir, { recursive: true, force: true })
console.log('ok — web static')
