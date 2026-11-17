import { createReadStream, statSync } from 'fs'
import { extname, join, resolve, sep } from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2'
}

/**
 * Serves the DamnedCloud web build (the LAN webapp) from `root`: GET/HEAD only, nothing outside
 * `root`, unknown paths fall back to index.html. Returns false when there is nothing to serve
 * (no build shipped), so the caller answers as before.
 */
export function serveWebApp(root: string | undefined, req: IncomingMessage, res: ServerResponse): boolean {
  if (!root || (req.method !== 'GET' && req.method !== 'HEAD')) return false
  const base = resolve(root)
  const index = join(base, 'index.html')
  if (!isFile(index)) return false
  let path: string
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    path = '/'
  }
  let file = resolve(base, '.' + path)
  if ((file !== base && !file.startsWith(base + sep)) || !isFile(file)) file = index
  const headers: Record<string, string> = {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    // vite hashes asset names: those can be cached, index.html must follow an IDE update
    'cache-control': file === index ? 'no-cache' : 'public, max-age=31536000, immutable'
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).on('error', () => res.destroy()).pipe(res)
  return true
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}
