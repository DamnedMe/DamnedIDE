// DamnedIDE as an MCP server: agents (the AI chat's Claude, Claude Code in a terminal, any MCP
// client) use the IDE's features through the tools of ide-tools.ts. Streamable HTTP on
// 127.0.0.1 only, JSON answers (no SSE stream: no tool needs to push), a bearer token saved in
// userData. Every call runs the curated remote command surface as the "MCP agent" with the scopes
// chosen in Settings › AI › MCP server; what the phone confirms is confirmed on the desktop here.
// ponytail: one listener per port; a second IDE instance on the same profile reports the port busy
// No electron import: main wires the confirmation dialog.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import { join } from 'path'
import { rmSync } from 'fs'
import { readJson, writeJson } from '../ado/ado-settings.store'
import { ALLINEA_PROD_INSTRUCTIONS, IDE_PROMPTS, IDE_TOOLS, activeRoot, commandArgs, type IdeTool } from './ide-tools'
import { remoteScopeFor } from '../remote/commands'
import { ALL_SCOPES } from '../../../src/shared/remote/protocol'
import type { ConfirmationChallenge, DeviceInfo, RemoteScope, WorkspaceSnapshot } from '../../../src/shared/remote/protocol'

export const MCP_DEFAULT_PORT = 8766
/** Name of the server in the agents' configuration: its tools are `mcp__damnedide__<tool>`. */
export const MCP_SERVER_NAME = 'damnedide'
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY = 8 * 1024 * 1024
const MAX_TEXT = 200_000
const LOG_SIZE = 40

export interface McpServerSettings {
  enabled: boolean
  port: number
  /** what the agent may do (the 'terminal' scope has no command yet) */
  scopes: RemoteScope[]
  token: string
}

export interface McpCall {
  at: number
  tool: string
  ok: boolean
  message?: string
}

export interface McpServerStatus {
  enabled: boolean
  listening: boolean
  port: number
  url: string
  token: string
  scopes: RemoteScope[]
  error?: string
  /** tools the scopes allow, for the settings page */
  tools: { name: string; description: string; allowed: boolean }[]
  calls: McpCall[]
}

export interface McpServerDeps {
  /** userData: mcp-server.json (settings + token) and mcp-agent.json (config handed to the chat's CLI) */
  dir: string
  appVersion: string
  execute: (cmd: string, args: Record<string, unknown>, device: DeviceInfo) => Promise<unknown>
  workspace: () => WorkspaceSnapshot
  /** asks the desktop user; true = go on */
  confirm: (challenge: ConfirmationChallenge) => Promise<boolean>
  changed?: () => void
}

interface RpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

const isScope = (s: unknown): s is RemoteScope => (ALL_SCOPES as unknown[]).includes(s)

export function sanitizeMcpSettings(raw: unknown): McpServerSettings {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const port = Number(r.port)
  return {
    enabled: r.enabled !== false,
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : MCP_DEFAULT_PORT,
    scopes: Array.isArray(r.scopes) ? [...new Set(r.scopes.filter(isScope))] : ['view'],
    token: typeof r.token === 'string' && r.token.length >= 32 ? r.token : randomBytes(24).toString('base64url')
  }
}

export class McpServerService {
  private deps: McpServerDeps
  private server: Server | null = null
  private listening = false
  private error: string | undefined
  private calls: McpCall[] = []

  constructor(deps: McpServerDeps) {
    this.deps = deps
  }

  private get settingsFile(): string { return join(this.deps.dir, 'mcp-server.json') }
  /** The `--mcp-config` file of the chat's Claude CLI; present only while this instance listens. */
  get agentConfigFile(): string { return join(this.deps.dir, 'mcp-agent.json') }

  settings(): McpServerSettings {
    const s = sanitizeMcpSettings(readJson(this.settingsFile))
    // first read: the token generated here is kept
    if (!readJson(this.settingsFile)) writeJson(this.settingsFile, s, 0o600)
    return s
  }

  status(): McpServerStatus {
    const s = this.settings()
    return {
      enabled: s.enabled,
      listening: this.listening,
      port: s.port,
      url: this.url(s.port),
      token: s.token,
      scopes: s.scopes,
      ...(this.error ? { error: this.error } : {}),
      tools: IDE_TOOLS.map(t => ({ name: t.name, description: t.description, allowed: s.scopes.includes(remoteScopeFor(t.cmd)) })),
      calls: this.calls
    }
  }

  /** Saves the changes, then listens again with them (or stops). */
  async update(patch: { enabled?: boolean; port?: number; scopes?: RemoteScope[]; newToken?: boolean }): Promise<McpServerStatus> {
    const current = this.settings()
    const next = sanitizeMcpSettings({
      ...current,
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.port !== undefined ? { port: patch.port } : {}),
      ...(patch.scopes !== undefined ? { scopes: patch.scopes } : {}),
      ...(patch.newToken ? { token: '' } : {})
    })
    writeJson(this.settingsFile, next, 0o600)
    // scopes and token are read on every request: only the listener itself needs a restart
    if (next.enabled !== current.enabled || next.port !== current.port || (next.enabled && !this.listening)) await this.start()
    else {
      if (this.listening) this.writeAgentConfig(next)
      this.deps.changed?.()
    }
    return this.status()
  }

  /** Listens with the saved settings (stops first); a busy port is reported, not thrown. */
  async start(): Promise<void> {
    await this.stop()
    const s = this.settings()
    this.error = undefined
    if (!s.enabled) {
      this.deps.changed?.()
      return
    }
    const server = createServer((req, res) => { void this.handle(req, res) })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(s.port, '127.0.0.1', () => resolve())
      })
      this.server = server
      this.listening = true
      this.writeAgentConfig(s)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      this.error = code === 'EADDRINUSE'
        ? `porta ${s.port} già in uso (un'altra finestra di DamnedIDE o un altro programma)`
        : (e as Error).message
    }
    this.deps.changed?.()
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (this.listening) rmSync(this.agentConfigFile, { force: true })
    this.listening = false
    if (server) {
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
      // keep-alive sockets of the agents would hold the port
      server.closeAllConnections()
      await closed
    }
  }

  /** The config file for the chat's CLI when this instance serves, else null. */
  agentConfig(): string | null {
    return this.listening ? this.agentConfigFile : null
  }

  private writeAgentConfig(s: McpServerSettings): void {
    writeJson(this.agentConfigFile, {
      mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: this.url(s.port), headers: { Authorization: `Bearer ${s.token}` } } }
    }, 0o600)
  }

  private url(port: number): string {
    return `http://127.0.0.1:${port}/mcp`
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      // an unread request body would reset the connection under the client's feet
      req.resume()
      res.writeHead(status, body === undefined ? headers : { 'Content-Type': 'application/json', ...headers })
      res.end(body === undefined ? undefined : JSON.stringify(body))
    }
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/mcp') return send(404, { error: 'not found' })
    // DNS rebinding: a web page may reach 127.0.0.1, it must not be able to drive the IDE
    const origin = req.headers.origin
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) return send(403, { error: 'origin not allowed' })
    if (!this.authorized(req.headers.authorization)) return send(401, { error: 'missing or wrong bearer token' }, { 'WWW-Authenticate': 'Bearer' })
    if (req.method !== 'POST') return send(405, { error: 'POST only' }, { Allow: 'POST' })

    let raw = ''
    try {
      raw = await new Promise<string>((resolve, reject) => {
        let size = 0
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_BODY) reject(new Error('body too large'))
          else chunks.push(c)
        })
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
      })
    } catch (e) {
      return send(413, { error: (e as Error).message })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
    }
    const batch = Array.isArray(parsed)
    const messages: unknown[] = batch ? parsed as unknown[] : [parsed]
    const answers = (await Promise.all(messages.map(m => this.rpc(m as RpcMessage)))).filter(a => a !== null)
    if (answers.length === 0) return send(202)
    send(200, batch ? answers : answers[0])
  }

  private authorized(header: string | undefined): boolean {
    const want = Buffer.from(`Bearer ${this.settings().token}`)
    const got = Buffer.from(header ?? '')
    return got.length === want.length && timingSafeEqual(got, want)
  }

  /** One JSON-RPC message; null for a notification. */
  async rpc(msg: RpcMessage): Promise<unknown> {
    if (!msg || typeof msg !== 'object' || msg.id === undefined || msg.id === null) return null
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result })
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } })
    switch (msg.method) {
      case 'initialize': {
        const asked = String(msg.params?.protocolVersion ?? '')
        return ok({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: 'DamnedIDE', version: this.deps.appVersion },
          instructions: 'Tools of the DamnedIDE desktop the user is working in: workspace, worktrees, git, files, ' +
            'SQL connections and Azure DevOps release. Call ide_workspace first. Destructive actions are confirmed ' +
            'by the user in DamnedIDE; a tool missing from the list needs a permission in Settings › AI › MCP server. ' +
            ALLINEA_PROD_INSTRUCTIONS
        })
      }
      case 'ping':
        return ok({})
      case 'tools/list': {
        const scopes = this.settings().scopes
        const tools = IDE_TOOLS.filter(t => scopes.includes(remoteScopeFor(t.cmd))).map(t => ({
          name: t.name, description: t.description, inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !t.readOnly }
        }))
        return ok({ tools })
      }
      case 'prompts/list':
        return ok({ prompts: IDE_PROMPTS.map(({ text: _text, ...p }) => p) })
      case 'prompts/get': {
        const prompt = IDE_PROMPTS.find(p => p.name === String(msg.params?.name ?? ''))
        if (!prompt) return fail(-32602, `unknown prompt: ${String(msg.params?.name)}`)
        const raw = msg.params?.arguments
        const args = raw && typeof raw === 'object' && !Array.isArray(raw)
          ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
          : {}
        return ok({ description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args) } }] })
      }
      case 'tools/call':
        return ok(await this.callTool(String(msg.params?.name ?? ''), msg.params?.arguments))
      default:
        return fail(-32601, `method not found: ${String(msg.method)}`)
    }
  }

  async callTool(name: string, rawArgs: unknown): Promise<ToolResult> {
    const settings = this.settings()
    const tool: IdeTool | undefined = IDE_TOOLS.find(t => t.name === name)
    if (!tool) return this.result(name, false, `unknown tool: ${name}`)
    const scope = remoteScopeFor(tool.cmd)
    if (!settings.scopes.includes(scope)) {
      return this.result(name, false, `not allowed: enable "${scope}" in DamnedIDE › Settings › AI › MCP server`)
    }
    const device: DeviceInfo = { id: 'mcp-agent', name: 'Agente MCP', platform: 'mcp', scopes: settings.scopes, createdAt: 0, lastSeen: null }
    const args = commandArgs(tool, rawArgs, activeRoot(this.deps.workspace()))
    try {
      let out: unknown
      try {
        out = await this.deps.execute(tool.cmd, args, device)
      } catch (e) {
        const err = e as { code?: string; challenge?: ConfirmationChallenge }
        if (err.code !== 'confirmation_required' || !err.challenge) throw e
        if (!(await this.deps.confirm(err.challenge))) return this.result(name, false, 'the user declined this action in DamnedIDE')
        out = await this.deps.execute(tool.cmd, { ...args, confirm: err.challenge.id }, device)
      }
      return this.result(name, true, typeof out === 'string' ? out : JSON.stringify(out ?? { ok: true }, null, 2))
    } catch (e) {
      return this.result(name, false, (e as Error)?.message || String(e))
    }
  }

  private result(tool: string, ok: boolean, text: string): ToolResult {
    this.calls = [{ at: Date.now(), tool, ok, ...(ok ? {} : { message: text }) }, ...this.calls].slice(0, LOG_SIZE)
    this.deps.changed?.()
    const cut = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… (cut: ${text.length - MAX_TEXT} more characters)` : text
    return { content: [{ type: 'text', text: cut }], ...(ok ? {} : { isError: true }) }
  }
}
