import { spawn, ChildProcess, execFile } from 'child_process'
import { createInterface } from 'readline'
import { BrowserWindow } from 'electron'
import { ClaudeService, ClaudeResult, ClaudeUsage, ClaudeEffort } from './claude.service'
import { resolveCommand } from '../process/resolve-command'

export type AgentProviderId = 'claude' | 'opencode' | 'codex' | 'cursor'

export interface AgentSendRequest {
  chatKey: string
  provider: AgentProviderId
  prompt: string
  cwd?: string
  system?: string
  model?: string
  effort?: string
  permissionMode?: string
  resume?: string
  history?: { role: 'user' | 'assistant'; text: string }[]
  // claude only: subscription CLI (default) or Anthropic API with the stored key
  backend?: 'subscription' | 'api'
}

export interface AgentProviderInfo {
  id: AgentProviderId
  label: string
  available: boolean
  detail: string
  models: { id: string; label: string }[]
  efforts: string[]
  permissionModes: string[]
  // true/false when the CLI can report its auth state (undefined if unknown)
  loggedIn?: boolean
  // command to run in the IDE terminal to sign in on the provider platform
  loginCommand?: string
  // the IDE can store an API key for this provider (Claude/Anthropic)
  supportsApiKey?: boolean
  // shown when the CLI is missing
  installHint?: string
  docsUrl?: string
}

// One event decoded from a provider's stream. `delta` is appended to the answer,
// `tool` surfaces activity, `sessionId` enables resume, `error` aborts the turn.
interface AgentEvent {
  sessionId?: string
  partId?: string
  delta?: string
  tool?: string
  error?: string
  usage?: ClaudeUsage
  costUsd?: number
}

interface CliSpec {
  id: AgentProviderId
  label: string
  command: string
  models: { id: string; label: string }[]
  efforts: string[]
  permissionModes: string[]
  // `--version` probe that decides availability
  versionArgs: string[]
  buildArgs: (req: AgentSendRequest) => string[]
  // opencode reads the prompt from stdin when no positional message is given;
  // codex reads it with a trailing `-`. Both keep spaces out of the argv (which
  // matters on Windows, where we launch the CLI through the shell).
  promptViaStdin: boolean
  parse: (line: string) => AgentEvent | null
  // sign-in command typed into the IDE terminal (interactive OAuth/TUI)
  loginCommand: string
  installHint: string
  docsUrl: string
  // the CLI can report whether credentials are configured
  probeAuth?: (run: (args: string[]) => Promise<string>) => Promise<{ loggedIn: boolean; detail: string }>
}

const OPENCODE_MODELS: { id: string; label: string }[] = [
  { id: 'opencode-go/deepseek-v4.1-flash', label: 'deepseek-v4.1-flash (opencode-go)' },
  { id: 'opencode-go/deepseek-v4-pro', label: 'deepseek-v4-pro (opencode-go)' },
  { id: 'opencode-go/glm-5.3', label: 'glm-5.3 (opencode-go)' },
  { id: 'opencode-go/kimi-k2.7-code', label: 'kimi-k2.7-code (opencode-go)' },
  { id: 'opencode-go/grok-4.7', label: 'grok-4.7 (opencode-go)' }
]

const CODEX_MODELS: { id: string; label: string }[] = [
  { id: 'gpt-5', label: 'gpt-5' },
  { id: 'gpt-5-codex', label: 'gpt-5-codex' },
  { id: 'gpt-5-mini', label: 'gpt-5-mini' }
]

const CURSOR_MODELS: { id: string; label: string }[] = [
  { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
  { id: 'claude-opus-4-5', label: 'claude-opus-4-5' },
  { id: 'gpt-5', label: 'gpt-5' },
  { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' }
]

function parseJson(line: string): Record<string, any> | null {
  if (!line.trim()) return null
  try { return JSON.parse(line) } catch { return null }
}

// opencode `run --format json`: one JSON event per line, `part` carries the data.
// A `text` event is a complete assistant text part (opencode does not stream
// partial tokens in JSON mode); `tool` events announce tool use; `step_finish`
// reports tokens/cost for the step; `error` carries a provider failure.
function parseOpencode(line: string): AgentEvent | null {
  const msg = parseJson(line)
  if (!msg) return null
  const ev: AgentEvent = {}
  if (typeof msg.sessionID === 'string') ev.sessionId = msg.sessionID
  const part = msg.part
  if (msg.type === 'text' && part?.type === 'text' && typeof part.text === 'string') {
    ev.delta = part.text
    if (typeof part.id === 'string') ev.partId = part.id
  } else if (msg.type === 'tool' && part) {
    ev.tool = part.tool || part.name || part.type
  } else if (msg.type === 'step_finish' && part) {
    const t = part.tokens as { input?: number; output?: number; cache?: { read?: number; write?: number } } | undefined
    if (typeof part.cost === 'number') ev.costUsd = part.cost
    if (t) {
      ev.usage = {
        inputTokens: t.input,
        outputTokens: t.output,
        cacheReadTokens: t.cache?.read,
        cacheWriteTokens: t.cache?.write
      }
    }
  } else if (msg.type === 'error') {
    ev.error = msg.error?.data?.message || msg.error?.name || 'errore del provider'
  }
  return ev
}

// Tolerant decoder for CLIs whose JSON schema we do not control (codex, cursor):
// pulls a session id and a text chunk out of the common shapes, otherwise treats
// a bare string field as text so the answer is never lost.
function parseGeneric(line: string): AgentEvent | null {
  const msg = parseJson(line)
  if (!msg) return null
  const ev: AgentEvent = {}
  const sid = msg.session_id || msg.sessionId || msg.thread_id || msg.threadId
  if (typeof sid === 'string') ev.sessionId = sid
  const item = msg.item || msg.part || msg.message || msg
  if (item && typeof item === 'object') {
    if (typeof item.text === 'string') ev.delta = item.text
    else if (typeof item.content === 'string') ev.delta = item.content
    else if (typeof item.delta === 'string') ev.delta = item.delta
    else if (typeof item.message === 'string') ev.delta = item.message
    const toolName = item.tool || item.name || item.tool_name
    if (typeof toolName === 'string') ev.tool = toolName
  }
  if (msg.type === 'error' || msg.error) {
    ev.error = msg.error?.message || msg.message || 'errore del provider'
  }
  if (typeof msg.cost === 'number') ev.costUsd = msg.cost
  return ev
}

const CLI_SPECS: CliSpec[] = [
  {
    id: 'opencode',
    label: 'opencode',
    command: 'opencode',
    models: OPENCODE_MODELS,
    efforts: ['minimal', 'low', 'medium', 'high', 'max'],
    permissionModes: ['default', 'auto'],
    versionArgs: ['--version'],
    // `--variant` maps to the provider-specific reasoning effort
    buildArgs: (req) => {
      const args = ['run', '--format', 'json']
      if (req.model) args.push('--model', req.model)
      if (req.resume) args.push('--session', req.resume)
      if (req.effort) args.push('--variant', req.effort)
      if (req.permissionMode === 'auto') args.push('--auto')
      return args
    },
    promptViaStdin: true,
    parse: parseOpencode,
    loginCommand: 'opencode auth login',
    installHint: 'npm install -g opencode-ai',
    docsUrl: 'https://opencode.ai/docs/',
    // `opencode auth list` prints the configured credentials (ANSI colored)
    probeAuth: async (run) => {
      const raw = await run(['auth', 'list'])
      const clean = raw.replace(/\x1b\[[0-9;]*m/g, '')
      const count = Number((clean.match(/—\s*(\d+)\s+credentials?/i) || [])[1] ?? NaN)
      const credentials = Number.isFinite(count) ? count : (clean.match(/•/g) || []).length
      return credentials > 0
        ? { loggedIn: true, detail: `${credentials} provider configurati` }
        : { loggedIn: false, detail: 'nessun provider configurato — accedi per usarli' }
    }
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    models: CODEX_MODELS,
    efforts: ['minimal', 'low', 'medium', 'high'],
    permissionModes: ['default'],
    versionArgs: ['--version'],
    // `codex exec` is the non-interactive entry point; `-` reads the prompt from
    // stdin, `resume <id>` continues a session.
    buildArgs: (req) => {
      const args = ['exec', '--json']
      if (req.model) args.push('--model', req.model)
      if (req.resume) args.push('resume', req.resume)
      args.push('-')
      return args
    },
    promptViaStdin: true,
    parse: parseGeneric,
    loginCommand: 'codex login',
    installHint: 'npm install -g @openai/codex',
    docsUrl: 'https://github.com/openai/codex'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    command: 'cursor-agent',
    models: CURSOR_MODELS,
    efforts: [],
    permissionModes: ['default'],
    versionArgs: ['--version'],
    buildArgs: (req) => {
      const args = ['-p', '--output-format', 'stream-json']
      if (req.model) args.push('--model', req.model)
      if (req.resume) args.push('--resume', req.resume)
      return args
    },
    promptViaStdin: true,
    parse: parseGeneric,
    loginCommand: 'cursor-agent login',
    installHint: 'installa Cursor Agent da cursor.com/cli',
    docsUrl: 'https://cursor.com/cli'
  }
]

interface Run {
  proc?: ChildProcess
}

// Multi-provider agent chat. Claude keeps its own service (subscription CLI or
// Anthropic API); every other provider is a thin adapter over its local CLI in
// headless streaming mode. Each `chatKey` is an independent run, so several
// conversations (even on different providers) can stream at the same time.
export class AgentService {
  private runs = new Map<string, Run>()
  private available = new Map<string, { available: boolean; detail: string }>()

  constructor(private claude: ClaudeService) {}

  private emit(win: BrowserWindow | null, channel: string, payload: unknown): void {
    const targets = win ? [win] : BrowserWindow.getAllWindows()
    for (const w of targets) {
      try { w.webContents.send(channel, payload) } catch { /* closed */ }
    }
  }

  private async probe(spec: CliSpec): Promise<{ available: boolean; detail: string }> {
    const cached = this.available.get(spec.id)
    if (cached) return cached
    const result = await new Promise<{ available: boolean; detail: string }>((resolve) => {
      const useShell = process.platform === 'win32'
      try {
        execFile(useShell ? spec.command : resolveCommand(spec.command), spec.versionArgs,
          { windowsHide: true, timeout: 8000, shell: useShell },
          (err, stdout) => {
            if (err && !stdout) resolve({ available: false, detail: `CLI '${spec.command}' non trovata nel PATH` })
            else resolve({ available: true, detail: String(stdout).trim().split('\n')[0] || 'disponibile' })
          })
      } catch {
        resolve({ available: false, detail: `CLI '${spec.command}' non trovata` })
      }
    })
    this.available.set(spec.id, result)
    return result
  }

  async providers(opts: { refresh?: boolean } = {}): Promise<AgentProviderInfo[]> {
    if (opts.refresh) this.available.clear()
    const claudeStatus = await this.claude.status()
    const claudeAvailable = claudeStatus.cli || claudeStatus.hasApiKey
    const claudeDetail = !claudeStatus.cli
      ? (claudeStatus.hasApiKey ? 'API key Anthropic configurata' : "CLI 'claude' non trovata e nessuna API key")
      : claudeStatus.loggedIn
        ? `${claudeStatus.subscriptionType || 'account'} · ${claudeStatus.email || claudeStatus.authMethod || ''}`.trim()
        : "non autenticato: esegui 'claude auth login'"

    const infos: AgentProviderInfo[] = [{
      id: 'claude',
      label: 'Claude',
      available: claudeAvailable,
      detail: claudeDetail,
      loggedIn: claudeStatus.cli ? claudeStatus.loggedIn : undefined,
      loginCommand: 'claude auth login',
      supportsApiKey: true,
      installHint: 'npm install -g @anthropic-ai/claude-code',
      docsUrl: 'https://claude.com/claude-code',
      models: [
        { id: 'claude-opus-5', label: 'Opus 5' },
        { id: 'claude-opus-4-8', label: 'Opus 4.8' },
        { id: 'claude-sonnet-5', label: 'Sonnet 5' },
        { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
        { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
        { id: 'claude-fable-5', label: 'Fable 5' }
      ],
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      permissionModes: ['default', 'acceptEdits', 'plan', 'bypassPermissions']
    }]

    for (const spec of CLI_SPECS) {
      const probe = await this.probe(spec)
      let loggedIn: boolean | undefined
      let detail = probe.detail
      if (probe.available && spec.probeAuth) {
        const auth = await spec.probeAuth((args) => this.runCliCapture(spec, args)).catch(() => null)
        if (auth) { loggedIn = auth.loggedIn; detail = auth.detail }
      }
      infos.push({
        id: spec.id,
        label: spec.label,
        available: probe.available,
        detail,
        loggedIn,
        loginCommand: spec.loginCommand,
        installHint: spec.installHint,
        docsUrl: spec.docsUrl,
        models: spec.models,
        efforts: spec.efforts,
        permissionModes: spec.permissionModes
      })
    }
    return infos
  }

  /** Cheap real round trip that proves the provider is authenticated. */
  async test(provider: AgentProviderId, win: BrowserWindow | null, backend?: 'subscription' | 'api', model?: string): Promise<ClaudeResult> {
    if (provider === 'claude') return this.claude.test(backend || 'subscription', win)
    // the chosen model matters: the CLI default may be a provider without credit
    return this.send({ chatKey: '__test__', provider, prompt: 'Rispondi solo con: ok', model: model || undefined }, win)
  }

  /** Runs a short CLI command capturing stdout+stderr (auth probes, status). */
  private runCliCapture(spec: CliSpec, args: string[]): Promise<string> {
    const useShell = process.platform === 'win32'
    return new Promise((resolve) => {
      execFile(useShell ? spec.command : resolveCommand(spec.command), args,
        { windowsHide: true, timeout: 15000, shell: useShell, maxBuffer: 4 * 1024 * 1024 },
        (_err, stdout, stderr) => resolve(`${stdout || ''}${stderr || ''}`))
    })
  }

  // dynamic model catalog for providers that can enumerate it (opencode)
  async listModels(provider: AgentProviderId): Promise<{ id: string; label: string }[]> {
    if (provider !== 'opencode') {
      return CLI_SPECS.find(s => s.id === provider)?.models || []
    }
    const out = await new Promise<string | null>((resolve) => {
      execFile('opencode', ['models'], { windowsHide: true, timeout: 15000, shell: process.platform === 'win32' },
        (err, stdout) => resolve(err && !stdout ? null : stdout))
    })
    if (!out) return OPENCODE_MODELS
    const ids = out.split('\n').map(l => l.trim()).filter(l => /^[\w.-]+\/[\w.-]+$/.test(l))
    return ids.length ? ids.map(id => ({ id, label: id })) : OPENCODE_MODELS
  }

  cancel(chatKey: string): void {
    const run = this.runs.get(chatKey)
    if (!run) return
    this.runs.delete(chatKey)
    try { run.proc?.kill() } catch { /* already dead */ }
  }

  async send(req: AgentSendRequest, win: BrowserWindow | null): Promise<ClaudeResult> {
    if (req.provider === 'claude') {
      return this.claude.send({
        chatKey: req.chatKey,
        prompt: req.prompt,
        backend: req.backend || 'subscription',
        model: req.model || 'claude-opus-5',
        effort: (req.effort as ClaudeEffort) || 'high',
        system: req.system,
        cwd: req.cwd,
        permissionMode: req.permissionMode,
        resume: req.resume,
        history: req.history
      }, win)
    }
    const spec = CLI_SPECS.find(s => s.id === req.provider)
    if (!spec) return { ok: false, error: `provider '${req.provider}' non supportato` }
    return this.sendCli(spec, req, win)
  }

  private sendCli(spec: CliSpec, req: AgentSendRequest, win: BrowserWindow | null): Promise<ClaudeResult> {
    return new Promise((resolve) => {
      const useShell = process.platform === 'win32'
      let proc: ChildProcess
      try {
        proc = spawn(useShell ? spec.command : resolveCommand(spec.command), spec.buildArgs(req), {
          cwd: req.cwd || process.cwd(),
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          shell: useShell
        })
      } catch (e) {
        resolve({ ok: false, error: `avvio di '${spec.command}' fallito: ${(e as Error).message}` })
        return
      }
      this.runs.set(req.chatKey, { proc })

      let text = ''
      let session = req.resume || ''
      let costUsd = 0
      let usage: ClaudeUsage | undefined
      let stderr = ''
      let failed = false
      let failure = ''
      const seenParts = new Set<string>()

      createInterface({ input: proc.stdout! }).on('line', (line) => {
        const ev = spec.parse(line)
        if (!ev) {
          // non-JSON output (progress logs): keep it as a fallback answer
          if (line.trim()) stderr += `${line}\n`
          return
        }
        if (ev.sessionId) session = ev.sessionId
        if (ev.delta) {
          // opencode emits whole text parts: never append the same part twice
          if (ev.partId) {
            if (seenParts.has(ev.partId)) return
            seenParts.add(ev.partId)
          }
          text += ev.delta
          this.emit(win, 'ai:chunk', { chatKey: req.chatKey, text: ev.delta })
        }
        if (ev.tool) this.emit(win, 'ai:tool', { chatKey: req.chatKey, name: ev.tool })
        if (ev.costUsd) costUsd = ev.costUsd
        if (ev.usage) usage = ev.usage
        if (ev.error) { failed = true; failure = ev.error }
      })

      proc.stderr!.on('data', (d) => { stderr += String(d) })
      proc.on('error', (e) => {
        this.runs.delete(req.chatKey)
        resolve({ ok: false, error: `avvio di '${spec.command}' fallito: ${e.message}` })
      })
      proc.on('exit', (code) => {
        this.runs.delete(req.chatKey)
        if (code === 0 && !failed) resolve({ ok: true, text, sessionId: session || undefined, costUsd, usage })
        else {
          const base = failure || text.trim() || stderr.trim() || `${spec.command} terminato con codice ${code ?? '?'}`
          // name the model: a provider error (e.g. "Insufficient Balance") is
          // actionable only if the user knows which model/provider produced it
          resolve({ ok: false, error: `${base}${req.model ? ` (modello: ${req.model})` : ` (modello predefinito di ${spec.label})`}` })
        }
      })

      if (spec.promptViaStdin) {
        proc.stdin!.end(req.prompt)
      } else {
        proc.stdin!.end()
      }
    })
  }

  cancelAll(): void {
    for (const key of [...this.runs.keys()]) this.cancel(key)
    this.claude.cancelAll()
  }
}
