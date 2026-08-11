import { spawn, ChildProcess, execFile } from 'child_process'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { join } from 'path'
import { createInterface } from 'readline'
import { app } from 'electron'

export interface RoslynTarget {
  file: string
  line: number
  column: number
}

export interface RoslynResult {
  symbol?: string
  targets: RoslynTarget[]
}

export interface RoslynDiagnostic {
  code?: string
  severity: string
  message: string
  line: number
  column: number
  endLine: number
  endColumn: number
}

export interface RoslynDiagnostics {
  diagnostics: RoslynDiagnostic[]
}

export interface RoslynHover {
  signature: string
  type: string
  summary: string
  kind: string
}

const BRIDGE_TFM = 'net8.0'

function bridgeDir(): string {
  return join(app.getAppPath(), 'ide-services', 'RoslynBridge')
}

/**
 * Spawns the Roslyn bridge (.NET sidecar) and answers symbol queries over NDJSON stdio.
 * The workspace is loaded once via MSBuildWorkspace, so F12/Ctrl+F12/Ctrl+Shift+F12 on
 * .cs files get real semantic results (definitions, implementations, references).
 */
export class RoslynService {
  private proc: ChildProcess | null = null
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private disabled = false
  ready = false

  private dllPath(): string {
    return join(bridgeDir(), 'bin', 'Release', BRIDGE_TFM, 'RoslynBridge.dll')
  }

  private ensureBuilt(): Promise<boolean> {
    if (existsSync(this.dllPath())) return Promise.resolve(true)
    return new Promise((resolve) => {
      execFile('dotnet', ['build', '-c', 'Release', bridgeDir()], { windowsHide: true, timeout: 300000 }, (err) => resolve(!err))
    })
  }

  private async start(): Promise<boolean> {
    if (this.disabled) return false
    if (this.proc) return true
    const built = await this.ensureBuilt()
    if (!built) {
      console.error('[roslyn] build bridge fallita: servizio disabilitato')
      this.disabled = true
      return false
    }
    this.proc = spawn('dotnet', [this.dllPath()], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc.on('error', () => {
      console.error('[roslyn] spawn fallito: servizio disabilitato')
      this.disabled = true
      this.proc = null
    })
    this.proc.on('exit', () => {
      for (const p of this.pending.values()) p.reject(new Error('roslyn bridge exited'))
      this.pending.clear()
      this.proc = null
      this.ready = false
    })
    const rl = createInterface({ input: this.proc.stdout! })
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line)
        if (msg?.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.ok) p.resolve(msg)
          else p.reject(new Error(msg.error || 'roslyn error'))
        }
      } catch { /* ignore malformed */ }
    })
    this.proc.stderr!.on('data', (d) => console.error('[roslyn]', String(d).trim()))
    return true
  }

  private send(cmd: string, payload: Record<string, unknown>, timeoutMs = 120000): Promise<any> {
    if (!this.proc) return Promise.reject(new Error('roslyn not started'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('roslyn timeout'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v) },
        reject: (e) => { clearTimeout(t); reject(e) }
      })
      this.proc!.stdin!.write(JSON.stringify({ id, cmd, ...payload }) + '\n')
    })
  }

  async open(solution: string): Promise<boolean> {
    if (!(await this.start())) return false
    await this.send('open', { solution }, 300000)
    this.ready = true
    return true
  }

  async findSolution(rootPath: string): Promise<string | null> {
    try {
      const entries = await readdir(rootPath, { withFileTypes: true })
      const sln = entries.find(e => e.isFile() && /\.slnx?$/i.test(e.name))
      if (sln) return join(rootPath, sln.name)
      const proj = entries.find(e => e.isFile() && e.name.endsWith('.csproj'))
      if (proj) return join(rootPath, proj.name)
    } catch { /* ignore */ }
    return null
  }

  async ensure(rootPath: string): Promise<boolean> {
    if (this.ready || this.disabled) return this.ready
    const solution = await this.findSolution(rootPath)
    if (!solution) {
      console.error('[roslyn] solution/csproj non trovata in', rootPath)
      this.disabled = true
      return false
    }
    try {
      return await this.open(solution)
    } catch (e) {
      console.error('[roslyn] open fallita:', (e as Error).message)
      this.disabled = true
      return false
    }
  }

  definition(file: string, line: number, column: number): Promise<RoslynResult | null> {
    return this.query('definition', file, line, column)
  }

  implementation(file: string, line: number, column: number): Promise<RoslynResult | null> {
    return this.query('implementation', file, line, column)
  }

  references(file: string, line: number, column: number): Promise<RoslynResult | null> {
    return this.query('references', file, line, column)
  }

  async diagnostics(file: string, text?: string): Promise<RoslynDiagnostics | null> {
    if (!this.ready) return null
    try {
      const msg = await this.send('diagnostics', { file, ...(text !== undefined ? { text } : {}) })
      if (!msg?.ok) return null
      return { diagnostics: (msg.diagnostics || []) as RoslynDiagnostic[] }
    } catch {
      return null
    }
  }

  async hover(file: string, line: number, column: number, text?: string): Promise<RoslynHover | null> {
    if (!this.ready) return null
    try {
      const msg = await this.send('hover', { file, line, column, ...(text !== undefined ? { text } : {}) })
      if (!msg?.ok) return null
      return { signature: msg.signature || '', type: msg.type || '', summary: msg.summary || '', kind: msg.kind || '' }
    } catch {
      return null
    }
  }

  private async query(cmd: string, file: string, line: number, column: number): Promise<RoslynResult | null> {
    if (!this.ready) return null
    try {
      const msg = await this.send(cmd, { file, line, column })
      if (!msg?.ok) return null
      return { symbol: msg.symbol || '', targets: (msg.targets || []) as RoslynTarget[] }
    } catch {
      return null
    }
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
  }
}
