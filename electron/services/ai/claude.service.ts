import { spawn, ChildProcess, execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { createInterface } from 'readline'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, safeStorage, BrowserWindow } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import { resolveCommand } from '../process/resolve-command'
import { parseCliEvent } from './stream-json'

export type ClaudeBackend = 'subscription' | 'api'
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ClaudeTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ClaudeSendRequest {
  chatKey: string
  prompt: string
  backend: ClaudeBackend
  model: string
  effort: ClaudeEffort
  system?: string
  cwd?: string
  permissionMode?: string
  // subscription: the CLI keeps the transcript on disk, so only the new turn
  // travels. api: the conversation is stateless, so the history is resent.
  resume?: string
  history?: ClaudeTurn[]
}

export interface ClaudeUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface ClaudeResult {
  ok: boolean
  text?: string
  error?: string
  sessionId?: string
  costUsd?: number
  usage?: ClaudeUsage
}

export interface ClaudeAuthStatus {
  cli: boolean
  loggedIn: boolean
  authMethod?: string
  email?: string
  subscriptionType?: string
  hasApiKey: boolean
}

// Streaming needs the whole answer, and a coding turn can easily run past the
// SDK's default: give it room rather than truncating mid-thought.
const MAX_TOKENS = 64000

function keyFile(): string {
  return join(app.getPath('userData'), 'anthropic-key.bin')
}

export function hasApiKey(): boolean {
  return existsSync(keyFile())
}

export function setApiKey(key: string | null): void {
  if (!key) {
    try { rmSync(keyFile()) } catch { /* already absent */ }
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('cifratura di sistema non disponibile: la API key non può essere salvata in sicurezza')
  }
  writeFileSync(keyFile(), safeStorage.encryptString(key), { mode: 0o600 })
}

function getApiKey(): string | null {
  try {
    return safeStorage.decryptString(readFileSync(keyFile()))
  } catch {
    return null
  }
}

function apiErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'API key non valida o revocata'
  if (e instanceof Anthropic.RateLimitError) return 'rate limit raggiunto, riprova tra poco'
  if (e instanceof Anthropic.BadRequestError) return `richiesta non valida: ${e.message}`
  if (e instanceof Anthropic.APIConnectionError) return 'connessione alle API Anthropic fallita'
  if (e instanceof Anthropic.APIError) return `errore API ${e.status}: ${e.message}`
  return (e as Error)?.message || String(e)
}

interface Run {
  proc?: ChildProcess
  abort?: AbortController
}


// Chat with Claude from inside the IDE, over two interchangeable backends:
//  • subscription — drives the local `claude` CLI in headless streaming mode, so
//    it reuses the existing `claude auth login` session (no API key, no extra
//    billing) and gets the full Claude Code toolset on the worktree.
//  • api — the Anthropic SDK with a stored key, for a plain chat without tools.
export class ClaudeService {
  private runs = new Map<string, Run>()

  private emit(win: BrowserWindow | null, channel: string, payload: unknown): void {
    const targets = win ? [win] : BrowserWindow.getAllWindows()
    for (const w of targets) {
      try { w.webContents.send(channel, payload) } catch { /* closed */ }
    }
  }

  async status(): Promise<ClaudeAuthStatus> {
    const base: ClaudeAuthStatus = { cli: false, loggedIn: false, hasApiKey: hasApiKey() }
    const out = await new Promise<string | null>((resolve) => {
      execFile(resolveCommand('claude'), ['auth', 'status'], { windowsHide: true, timeout: 15000 },
        (err, stdout) => resolve(err && !stdout ? null : stdout))
    })
    if (out === null) return base
    base.cli = true
    try {
      const j = JSON.parse(out) as { loggedIn?: boolean; authMethod?: string; email?: string; subscriptionType?: string }
      base.loggedIn = !!j.loggedIn
      base.authMethod = j.authMethod
      base.email = j.email
      base.subscriptionType = j.subscriptionType
    } catch { /* unexpected output: CLI present but status unreadable */ }
    return base
  }

  // `claude auth status` (and an MCP tools/list) succeed on an expired token:
  // neither touches the API. The only honest check is a real round trip, so
  // spend one cheap turn on the smallest model rather than show a green light
  // that means "credentials on disk".
  async test(backend: ClaudeBackend, win: BrowserWindow | null): Promise<ClaudeResult> {
    return this.send({
      chatKey: '__test__',
      prompt: 'Rispondi solo con: ok',
      backend,
      model: backend === 'api' ? 'claude-haiku-4-5' : 'haiku',
      effort: 'low',
      permissionMode: 'default'
    }, win)
  }

  cancel(chatKey: string): void {
    const run = this.runs.get(chatKey)
    if (!run) return
    this.runs.delete(chatKey)
    try { run.proc?.kill() } catch { /* already dead */ }
    run.abort?.abort()
  }

  send(req: ClaudeSendRequest, win: BrowserWindow | null): Promise<ClaudeResult> {
    this.cancel(req.chatKey)
    return req.backend === 'api' ? this.sendApi(req, win) : this.sendCli(req, win)
  }

  // `claude -p --output-format stream-json`: newline-delimited events on stdout,
  // same shape the Agent SDK consumes. --resume keeps the transcript CLI-side so
  // each turn only sends the new message.
  private sendCli(req: ClaudeSendRequest, win: BrowserWindow | null): Promise<ClaudeResult> {
    return new Promise((resolve) => {
      const sessionId = req.resume || randomUUID()
      const args = [
        '-p',
        '--output-format', 'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--model', req.model,
        '--effort', req.effort,
        '--permission-mode', req.permissionMode || 'default',
        req.resume ? '--resume' : '--session-id', sessionId
      ]
      if (req.system) args.push('--append-system-prompt', req.system)

      let proc: ChildProcess
      try {
        proc = spawn(resolveCommand('claude'), args, {
          cwd: req.cwd || process.cwd(),
          env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'damnedide' },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        })
      } catch (e) {
        resolve({ ok: false, error: (e as Error).message })
        return
      }
      this.runs.set(req.chatKey, { proc })

      let text = ''
      let session = sessionId
      let costUsd = 0
      let usage: ClaudeUsage | undefined
      let stderr = ''
      let failed = false

      createInterface({ input: proc.stdout! }).on('line', (line) => {
        const ev = parseCliEvent(line)
        if (!ev) return
        if (ev.sessionId) session = ev.sessionId
        if (ev.delta) {
          text += ev.delta
          this.emit(win, 'ai:chunk', { chatKey: req.chatKey, text: ev.delta })
        }
        if (ev.tool) this.emit(win, 'ai:tool', { chatKey: req.chatKey, name: ev.tool })
        if (ev.final) {
          costUsd = ev.final.costUsd
          usage = ev.final.usage
          failed = ev.final.isError
          // partial-message deltas are best effort: fall back to the final text
          if (!text && ev.final.text) {
            text = ev.final.text
            this.emit(win, 'ai:chunk', { chatKey: req.chatKey, text })
          }
        }
      })

      proc.stderr!.on('data', (d) => { stderr += String(d) })
      proc.on('error', (e) => {
        this.runs.delete(req.chatKey)
        resolve({ ok: false, error: `avvio di 'claude' fallito: ${e.message}` })
      })
      proc.on('exit', (code) => {
        this.runs.delete(req.chatKey)
        // a non-zero exit (or an is_error result) is a failure even when the CLI
        // printed text: that text is the failure reason, not an answer
        if (code === 0 && !failed) resolve({ ok: true, text, sessionId: session, costUsd, usage })
        else resolve({ ok: false, error: text.trim() || stderr.trim() || `claude terminato con codice ${code ?? '?'}` })
      })

      proc.stdin!.end(req.prompt)
    })
  }

  private async sendApi(req: ClaudeSendRequest, win: BrowserWindow | null): Promise<ClaudeResult> {
    const apiKey = getApiKey()
    if (!apiKey) return { ok: false, error: 'nessuna API key Anthropic configurata nelle impostazioni' }
    const abort = new AbortController()
    this.runs.set(req.chatKey, { abort })
    try {
      const client = new Anthropic({ apiKey })
      const messages: Anthropic.MessageParam[] = [
        ...(req.history || []).map((t) => ({ role: t.role, content: t.text })),
        { role: 'user', content: req.prompt }
      ]
      const stream = client.messages.stream({
        model: req.model,
        max_tokens: MAX_TOKENS,
        system: req.system || undefined,
        messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: req.effort },
        // the whole prefix (system + previous turns) is served from cache on every
        // follow-up instead of being re-billed in full
        cache_control: { type: 'ephemeral' }
      }, { signal: abort.signal })

      stream.on('text', (t) => this.emit(win, 'ai:chunk', { chatKey: req.chatKey, text: t }))
      const final = await stream.finalMessage()
      const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      if (final.stop_reason === 'refusal') {
        return { ok: false, error: `richiesta rifiutata dal modello (${final.stop_details?.category ?? 'nessuna categoria'})` }
      }
      return {
        ok: true,
        text,
        usage: {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
          cacheReadTokens: final.usage.cache_read_input_tokens ?? undefined,
          cacheWriteTokens: final.usage.cache_creation_input_tokens ?? undefined
        }
      }
    } catch (e) {
      if (abort.signal.aborted) return { ok: false, error: 'annullato' }
      return { ok: false, error: apiErrorMessage(e) }
    } finally {
      this.runs.delete(req.chatKey)
    }
  }

  cancelAll(): void {
    for (const key of [...this.runs.keys()]) this.cancel(key)
  }
}
