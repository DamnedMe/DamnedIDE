import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import { createInterface } from 'readline'

export interface McpTool {
  name: string
  description: string
  inputSchema?: unknown
}

export interface McpServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

interface McpSession {
  config: McpServerConfig
  proc: ChildProcess
  tools: McpTool[]
  pending: Map<number, Pending>
  nextId: number
}

const PROTOCOL_VERSION = '2024-11-05'

// Minimal MCP (Model Context Protocol) CLIENT over stdio: launches an MCP server
// process (e.g. `claude mcp serve`, `opencode mcp start`, …) and speaks JSON-RPC
// 2.0 (newline-delimited) to list and call its tools.
export class McpService {
  private sessions = new Map<string, McpSession>()

  private emit(win: BrowserWindow | null, channel: string, payload: unknown) {
    const targets = win ? [win] : BrowserWindow.getAllWindows()
    for (const w of targets) {
      try { w.webContents.send(channel, payload) } catch { /* closed */ }
    }
  }

  private log(name: string, message: string) {
    console.error(`[mcp] ${name}: ${message}`)
    this.emit(null, 'mcp:log', { name, message })
  }

  private handleLine(session: McpSession, line: string, win: BrowserWindow | null) {
    if (!line.trim()) return
    let msg: Record<string, unknown>
    try { msg = JSON.parse(line) } catch { return }
    const id = msg.id as number | undefined
    if (typeof id === 'number' && session.pending.has(id)) {
      const p = session.pending.get(id)!
      session.pending.delete(id)
      if (msg.error) p.reject(new Error((msg.error as { message?: string }).message || 'mcp error'))
      else p.resolve(msg.result)
      return
    }
    // server-initiated notifications / log messages
    if (msg.method === 'notifications/message') {
      const params = msg.params as { level?: string; data?: unknown }
      this.log(session.config.name, `[${params?.level || 'info'}] ${JSON.stringify(params?.data ?? '')}`)
    }
  }

  private send(session: McpSession, method: string, params: unknown, timeoutMs = 20000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = session.nextId++
      const t = setTimeout(() => { session.pending.delete(id); reject(new Error(`mcp ${method} timeout`)) }, timeoutMs)
      session.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      try {
        session.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      } catch (e) {
        session.pending.delete(id); clearTimeout(t); reject(e as Error)
      }
    })
  }

  private sendNotify(session: McpSession, method: string, params: unknown) {
    try { session.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n') } catch { /* closed */ }
  }

  async connect(config: McpServerConfig, win: BrowserWindow | null): Promise<{ ok: boolean; error?: string; tools: McpTool[] }> {
    this.disconnect(config.name)
    let proc: ChildProcess
    try {
      proc = spawn(config.command, config.args, {
        env: { ...process.env, ...(config.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (e) {
      return { ok: false, error: (e as Error).message, tools: [] }
    }
    const session: McpSession = { config, proc, tools: [], pending: new Map(), nextId: 1 }
    this.sessions.set(config.name, session)
    createInterface({ input: proc.stdout! }).on('line', (l) => this.handleLine(session, l, win))
    proc.stderr!.on('data', (d) => { try { this.log(config.name, String(d).trim()) } catch { /* ignore */ } })
    proc.on('error', (e) => { this.log(config.name, `errore avvio: ${e.message}`); this.sessions.delete(config.name) })
    proc.on('exit', (code) => {
      this.sessions.delete(config.name)
      this.log(config.name, `processo terminato (${code ?? '?'})`)
      this.emit(win, 'mcp:tools', { name: config.name, tools: [] })
    })
    try {
      await this.send(session, 'initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'DamnedIDE', version: '0.0.1' }
      })
      this.sendNotify(session, 'notifications/initialized', {})
      const list = (await this.send(session, 'tools/list', {})) as { tools?: { name: string; description?: string; inputSchema?: unknown }[] }
      session.tools = (list?.tools || []).map(t => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema }))
      this.emit(win, 'mcp:tools', { name: config.name, tools: session.tools })
      return { ok: true, tools: session.tools }
    } catch (e) {
      this.log(config.name, `connessione fallita: ${(e as Error).message}`)
      this.disconnect(config.name)
      return { ok: false, error: (e as Error).message, tools: [] }
    }
  }

  async callTool(name: string, tool: string, args: Record<string, unknown>, win: BrowserWindow | null): Promise<unknown> {
    const session = this.sessions.get(name)
    if (!session) throw new Error(`MCP server '${name}' non connesso`)
    try {
      const res = (await this.send(session, 'tools/call', { name: tool, arguments: args })) as { content?: { type?: string; text?: string }[] }
      const text = (res?.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('\n')
      this.emit(win, 'mcp:log', { name, message: `call ${tool}` })
      return text || JSON.stringify(res)
    } catch (e) {
      throw e
    }
  }

  listTools(name: string): McpTool[] {
    return this.sessions.get(name)?.tools || []
  }

  disconnect(name: string): void {
    const session = this.sessions.get(name)
    if (session) {
      try { session.proc.kill() } catch { /* ignore */ }
      for (const p of session.pending.values()) p.reject(new Error('mcp disconnected'))
      this.sessions.delete(name)
    }
  }

  disconnectAll(): void {
    for (const name of [...this.sessions.keys()]) this.disconnect(name)
  }
}
