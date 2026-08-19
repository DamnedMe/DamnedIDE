import { spawn, execFile, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'

interface RunningProcess {
  id: string
  proc: ChildProcess
  cwd: string
}

const processes = new Map<string, RunningProcess>()
let nextId = 1

/**
 * Force-kills a process and its whole descendant tree on Windows. `taskkill /T`
 * terminates the root AND every child in one pass, which is what keeps
 * `dotnet run` (and the app exe it launches) from surviving a stop.
 */
export function killProcessTree(rootPid: number): void {
  if (!rootPid) return
  try {
    execFile('taskkill', ['/PID', String(rootPid), '/T', '/F'], { windowsHide: true }, () => { /* best effort */ })
  } catch { /* ignore */ }
}

function sendToWindow(targetWindow: BrowserWindow | null, channel: string, ...args: unknown[]) {
  const targets = targetWindow ? [targetWindow] : BrowserWindow.getAllWindows()
  for (const w of targets) {
    try { w.webContents.send(channel, ...args) } catch { /* closed */ }
  }
}

export function startProcess(cwd: string, command: string, args: string[], targetWindow: BrowserWindow | null): string {
  const id = `proc_${nextId++}`
  const proc = spawn(command, args, {
    cwd,
    stdio: 'pipe',
    shell: process.platform === 'win32'
  })

  processes.set(id, { id, proc, cwd })

  if (proc.stdout) {
    proc.stdout.on('data', (chunk: Buffer) => sendToWindow(targetWindow, 'process:output', id, chunk.toString()))
  }
  if (proc.stderr) {
    proc.stderr.on('data', (chunk: Buffer) => sendToWindow(targetWindow, 'process:output', id, chunk.toString()))
  }
  proc.on('error', (err) => {
    sendToWindow(targetWindow, 'process:output', id, `\r\n\x1b[31m${err.message}\x1b[0m\r\n`)
  })
  proc.on('exit', (code) => {
    sendToWindow(targetWindow, 'process:exit', id, code)
    processes.delete(id)
  })

  return id
}

export function stopProcess(id: string): void {
  const session = processes.get(id)
  if (!session) return
  processes.delete(id)
  if (process.platform === 'win32' && session.proc.pid) {
    // Kill the whole process tree (dotnet run spawns the app as a child)
    killProcessTree(session.proc.pid)
  } else if (session.proc.pid) {
    try { session.proc.kill('SIGTERM') } catch { /* ignore */ }
  }
}

export function stopAllProcesses(): void {
  for (const [id] of processes) stopProcess(id)
}
