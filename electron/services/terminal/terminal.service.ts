import { spawn as ptySpawn, IPty } from '@homebridge/node-pty-prebuilt-multiarch'
import { BrowserWindow } from 'electron'
import { execSync } from 'child_process'
import { killProcessTree } from '../process/process.service'

export type TerminalType = 'cmd' | 'powershell' | 'pwsh' | 'npm'

interface TerminalSession {
  id: string
  pty: IPty
  windowId: number | null
  cwd: string
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
      return { executable: process.env.ComSpec || 'cmd.exe', args: [] }
  }
}

// Real pseudo-terminal (ConPTY on Windows) via node-pty: interactive shells and
// TUI programs (opencode, vim, …) work natively, with echo, backspace and colors.
export function createTerminal(cwd: string, type: TerminalType, targetWindow: BrowserWindow | null): string {
  const id = `term_${nextId++}`
  const { executable, args } = shellFor(type)

  const send = (data: string) => {
    const targets = targetWindow
      ? [targetWindow]
      : BrowserWindow.getAllWindows()
    for (const w of targets) {
      try { w.webContents.send('terminal:data', id, data) } catch { /* closed */ }
    }
  }

  let pty: IPty
  try {
    pty = ptySpawn(executable, args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
      name: 'xterm-256color',
      cols: 100,
      rows: 30
    })
  } catch (err) {
    send(`\r\n\x1b[31m[errore avvio shell: ${(err as Error).message}]\x1b[0m\r\n`)
    return id
  }

  const session: TerminalSession = { id, pty, windowId: targetWindow?.id ?? null, cwd: cwd || process.cwd() }
  sessions.set(id, session)

  pty.onData((data: string) => send(data))

  pty.onExit(({ exitCode }) => {
    send(`\r\n\x1b[33m[process exited (${exitCode})]\x1b[0m\r\n`)
    sessions.delete(id)
  })

  return id
}

export function writeToTerminal(id: string, data: string): void {
  const session = sessions.get(id)
  if (session) {
    try { session.pty.write(data) } catch { /* closed */ }
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const session = sessions.get(id)
  if (session) {
    try { session.pty.resize(cols, rows) } catch { /* ignore */ }
  }
}

export function destroyTerminal(id: string): void {
  const session = sessions.get(id)
  if (session) {
    try { session.pty.kill() } catch { /* ignore */ }
    // pty.kill() terminates the shell only: `dotnet run` launched inside the
    // terminal (and the app exe it spawns) would survive as orphans and keep
    // their ports bound. Kill the whole shell tree too.
    try { killProcessTree(session.pty.pid) } catch { /* ignore */ }
    sessions.delete(id)
  }
}

export function destroyAllTerminals(): void {
  for (const [id] of sessions) destroyTerminal(id)
}

function normalizeForCompare(p: string): string {
  return p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

// A terminal whose shell cwd lives inside a worktree keeps a handle on that
// folder on Windows, so `rm -rf` / `git worktree remove` fail with EBUSY. Kill
// every terminal rooted in (or under) `root` before removing the worktree.
export function destroyTerminalsUnderPath(root: string): number {
  const target = normalizeForCompare(root)
  if (!target) return 0
  let killed = 0
  for (const [id, session] of [...sessions]) {
    const cwd = normalizeForCompare(session.cwd)
    if (cwd === target || cwd.startsWith(`${target}/`)) {
      destroyTerminal(id)
      killed++
    }
  }
  return killed
}
