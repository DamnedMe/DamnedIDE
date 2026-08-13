import { spawn, ChildProcess, execSync } from 'child_process'
import { BrowserWindow } from 'electron'

export type TerminalType = 'cmd' | 'powershell' | 'pwsh' | 'npm'

interface TerminalSession {
  id: string
  process: ChildProcess
  windowId: number | null
}

const sessions = new Map<string, TerminalSession>()
let nextId = 1

let pwshChecked = false
let pwshFound = false

function pwshAvailable(): boolean {
  if (!pwshChecked) {
    pwshChecked = true
    try {
      execSync('where pwsh.exe', { stdio: 'ignore', windowsHide: true })
      pwshFound = true
    } catch { /* not installed */ }
  }
  return pwshFound
}

function shellFor(type: TerminalType): { executable: string; args: string[] } {
  switch (type) {
    case 'powershell':
      return { executable: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] }
    case 'pwsh':
      // PowerShell 7 may not be installed: fall back to Windows PowerShell
      return pwshAvailable()
        ? { executable: 'pwsh.exe', args: ['-NoLogo', '-NoProfile'] }
        : { executable: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] }
    case 'npm':
      return { executable: process.env.ComSpec || 'cmd.exe', args: [] }
    default:
      // /Q disables cmd's own command echo (the renderer echoes the typed line locally)
      return { executable: process.env.ComSpec || 'cmd.exe', args: ['/Q'] }
  }
}

export function createTerminal(cwd: string, type: TerminalType, targetWindow: BrowserWindow | null): string {
  const id = `term_${nextId++}`
  const { executable, args } = shellFor(type)

  const proc = spawn(executable, args, {
    cwd: cwd || process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: 'pipe',
    windowsHide: true
  })

  const session: TerminalSession = { id, process: proc, windowId: targetWindow?.id ?? null }
  sessions.set(id, session)

  const send = (data: string) => {
    const targets = targetWindow
      ? [targetWindow]
      : BrowserWindow.getAllWindows()
    for (const w of targets) {
      try { w.webContents.send('terminal:data', id, data) } catch { /* closed */ }
    }
  }

  proc.on('error', (err) => {
    send(`\r\n\x1b[31m[errore avvio shell: ${err.message}]\x1b[0m\r\n`)
    sessions.delete(id)
  })

  if (proc.stdout) {
    proc.stdout.on('data', (chunk: Buffer) => send(chunk.toString()))
  }
  if (proc.stderr) {
    proc.stderr.on('data', (chunk: Buffer) => send(chunk.toString()))
  }
  proc.on('exit', () => {
    send('\r\n\x1b[33m[process exited]\x1b[0m\r\n')
    sessions.delete(id)
  })

  return id
}

export function writeToTerminal(id: string, data: string): void {
  const session = sessions.get(id)
  if (session && session.process.stdin && !session.process.stdin.destroyed) {
    session.process.stdin.write(data)
  }
}

export function resizeTerminal(_id: string, _cols: number, _rows: number): void {
  // not supported with child_process
}

export function destroyTerminal(id: string): void {
  const session = sessions.get(id)
  if (session) {
    try { session.process.kill() } catch { /* ignore */ }
    sessions.delete(id)
  }
}

export function destroyAllTerminals(): void {
  for (const [id] of sessions) destroyTerminal(id)
}
