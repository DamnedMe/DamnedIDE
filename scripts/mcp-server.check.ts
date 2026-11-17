// Self-check for DamnedIDE as an MCP server (electron/services/mcp/mcp-server.service.ts): the real
// HTTP listener on 127.0.0.1, driven as an MCP client would, with a fake command surface and a
// fake confirmation dialog. Settings and the agent config live in a temp dir.
// Run: node --experimental-strip-types scripts/mcp-server.check.ts
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (e) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context)
      throw e
    }
  },
  // commands.ts (scope rule) has constructor parameter properties and type-only value imports
  load(url, context, next) {
    if (!/\/electron\/.*\.ts$/.test(url)) return next(url, context)
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf-8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
})
const { McpServerService, sanitizeMcpSettings } = await import('../electron/services/mcp/mcp-server.service.ts')
const { IDE_TOOLS, commandArgs } = await import('../electron/services/mcp/ide-tools.ts')

setTimeout(() => { console.error('mcp server check: hard timeout'); process.exit(2) }, 30000).unref()

const freePort = () => new Promise<number>((res) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)) })
})

// ── argument mapping ──
const root = resolve(tmpdir(), 'repo')
const tool = (name: string) => IDE_TOOLS.find(t => t.name === name)!
assert.deepEqual(commandArgs(tool('file_read'), { file: 'src/a.ts', confirm: 'forged' }, root), { file: resolve(root, 'src/a.ts') },
  'relative paths resolve against the active root; the agent cannot pass a confirmation id')
assert.deepEqual(commandArgs(tool('file_list'), {}, root), { root }, 'a folder defaults to the active root')
assert.deepEqual(commandArgs(tool('git_diff'), { file: 'a.ts' }, root), { file: 'a.ts', repoPath: root }, 'git files stay relative to the repository')
assert.deepEqual(commandArgs(tool('ide_open_file'), { filePath: 'b.ts', line: 3 }, root), { filePath: resolve(root, 'b.ts'), line: 3, rootPath: root })
assert.equal(new Set(IDE_TOOLS.map(t => t.name)).size, IDE_TOOLS.length, 'tool names are unique')
assert.ok(IDE_TOOLS.every(t => /^[a-z_]{1,64}$/.test(t.name)), 'tool names fit every MCP client')

// ── settings ──
assert.deepEqual(sanitizeMcpSettings({ port: 80, scopes: ['view', 'root', 'git'] }).port, 8766, 'a privileged port goes back to the default')
assert.deepEqual(sanitizeMcpSettings({ scopes: ['view', 'root', 'git'] }).scopes, ['view', 'git'])
assert.equal(sanitizeMcpSettings({}).enabled, true)
assert.deepEqual(sanitizeMcpSettings({}).scopes, ['view'], 'read only until the user grants more')

// ── server ──
const dir = mkdtempSync(join(tmpdir(), 'damned-mcp-'))
const calls: { cmd: string; args: Record<string, unknown>; scopes: string[] }[] = []
let answer = true
const asked: string[] = []
const server = new McpServerService({
  dir,
  appVersion: '0.0.0-check',
  workspace: () => ({ revision: 1, repoPath: root, selectedWorktree: null, activePanel: 'worktree', editorNav: null }),
  execute: async (cmd, args, device) => {
    calls.push({ cmd, args, scopes: device.scopes })
    if (cmd === 'git.discard' && !args.confirm) {
      throw Object.assign(new Error('confirm'), { code: 'confirmation_required', challenge: { id: 'ch1', command: cmd, summary: 'Scartare?', destructive: true, createdAt: 0, expiresAt: 0 } })
    }
    if (cmd === 'fs.read' && String(args.file).endsWith('missing.ts')) throw new Error('ENOENT: missing.ts')
    return cmd === 'fs.read' ? { content: 'hello' } : { ok: true }
  },
  confirm: async (c) => { asked.push(c.summary); return answer }
})
const port = await freePort()
await server.update({ port })
const status = server.status()
assert.equal(status.listening, true)
const token = status.token
assert.ok(token.length >= 32)
const agent = JSON.parse(readFileSync(server.agentConfigFile, 'utf8'))
assert.deepEqual(agent.mcpServers.damnedide, { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } })

let seq = 0
const post = async (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${token}` }) => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })
  return { status: res.status, body: res.status === 202 ? null : await res.json() as any }
}
const rpc = async (method: string, params?: unknown) => (await post({ jsonrpc: '2.0', id: ++seq, method, params })).body

assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {})).status, 401, 'no token, no IDE')
assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer wrong' })).status, 401)
assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' })).status, 403, 'a web page cannot drive it')
assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, { headers: { Authorization: `Bearer ${token}` } })).status, 405)

const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'check', version: '1' } })
assert.equal(init.result.protocolVersion, '2025-03-26')
assert.equal(init.result.serverInfo.name, 'DamnedIDE')
assert.ok(init.result.capabilities.tools)
assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202, 'a notification gets no answer')
assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18', 'an unknown version gets the latest')

// read only: the write and git tools are not even listed, and refused if called anyway
const listed = (await rpc('tools/list')).result.tools.map((t: { name: string }) => t.name)
assert.ok(listed.includes('file_read') && listed.includes('git_diff') && listed.includes('ide_workspace'))
assert.ok(!listed.includes('file_write') && !listed.includes('git_commit') && !listed.includes('sql_query'))
const refused = (await rpc('tools/call', { name: 'git_commit', arguments: { message: 'x' } })).result
assert.equal(refused.isError, true)
assert.match(refused.content[0].text, /not allowed: enable "git"/)
assert.equal(calls.length, 0)

const read = (await rpc('tools/call', { name: 'file_read', arguments: { file: 'src/a.ts' } })).result
assert.equal(read.isError, undefined)
assert.deepEqual(JSON.parse(read.content[0].text), { content: 'hello' })
assert.deepEqual(calls.at(-1), { cmd: 'fs.read', args: { file: resolve(root, 'src/a.ts') }, scopes: ['view'] })
const failed = (await rpc('tools/call', { name: 'file_read', arguments: { file: 'missing.ts' } })).result
assert.deepEqual([failed.isError, failed.content[0].text], [true, 'ENOENT: missing.ts'], 'a command error is a tool error, not a protocol one')
assert.equal((await rpc('tools/call', { name: 'nope' })).result.isError, true)
assert.equal((await rpc('resources/list')).error.code, -32601)

// git granted: the confirmation goes to the desktop dialog
await server.update({ scopes: ['view', 'git'] })
calls.length = 0
const ok = (await rpc('tools/call', { name: 'git_discard', arguments: { file: 'a.ts' } })).result
assert.equal(ok.isError, undefined)
assert.deepEqual(asked, ['Scartare?'])
assert.deepEqual(calls.map(c => c.args.confirm), [undefined, 'ch1'], 'retried with the challenge the desktop accepted')
answer = false
calls.length = 0
const declined = (await rpc('tools/call', { name: 'git_discard', arguments: { file: 'a.ts', confirm: 'ch1' } })).result
assert.deepEqual([declined.isError, declined.content[0].text], [true, 'the user declined this action in DamnedIDE'])
assert.deepEqual(calls.map(c => c.args.confirm), [undefined], 'nothing runs after a refusal; the forged id was dropped')

// batch
const batch = await post([{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }, { jsonrpc: '2.0', id: 'b', method: 'ping' }])
assert.deepEqual(batch.body.map((r: { id: string }) => r.id), ['a', 'b'])

assert.equal(server.status().calls[0].tool, 'git_discard', 'the settings page lists the calls, newest first')

// a new token locks the old one out
await server.update({ newToken: true })
assert.notEqual(server.status().token, token)
assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401)

// a busy port is reported, not thrown; off removes the agent config
const other = new McpServerService({ dir: mkdtempSync(join(tmpdir(), 'damned-mcp-b-')), appVersion: '0', workspace: () => ({ revision: 0, repoPath: null, selectedWorktree: null, activePanel: '', editorNav: null }), execute: async () => null, confirm: async () => false })
const busy = await other.update({ port })
assert.deepEqual([busy.listening, /già in uso/.test(busy.error ?? '')], [false, true])
assert.equal(other.agentConfig(), null, 'the chat gets no server it cannot reach')
await server.update({ enabled: false })
assert.equal(existsSync(server.agentConfigFile), false)
assert.equal(server.agentConfig(), null)

rmSync(dir, { recursive: true, force: true })
console.log('ok — mcp server')
