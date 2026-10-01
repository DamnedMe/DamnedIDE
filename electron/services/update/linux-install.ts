import { spawn } from 'child_process'

// Native Linux package update: download through electron-updater (the CI adds
// the .pacman file to the feed) and install it with an async privileged command,
// the same approach GitTree uses. Never electron-updater's own Linux installer:
// that one spawns sudo/pkexec synchronously inside the quit event and blocks the
// process on the password prompt.

export type NativePackageType = 'pacman' | 'deb' | 'rpm'

/**
 * Privileged install command for a downloaded native package.
 * - pacman: `--disable-sandbox` because pacman 7 cannot read files under $HOME
 *   when running as root (the update cache lives in ~/.cache), `--overwrite *`
 *   for files left behind by a previous package.
 * - deb/rpm: the distro tools through pkexec.
 */
export function buildNativeInstallCommand(packageType: NativePackageType, packagePath: string, pkexec = '/usr/bin/pkexec'): string[] {
  switch (packageType) {
    case 'pacman':
      return [pkexec, '/usr/bin/pacman', '-U', '--noconfirm', '--disable-sandbox', '--overwrite', '*', packagePath]
    case 'deb':
      return [pkexec, 'dpkg', '-i', packagePath]
    case 'rpm':
      return [pkexec, 'rpm', '-Uvh', packagePath]
  }
}

export interface InstallResult {
  ok: boolean
  error?: string
  restartRequired?: boolean
}

/** Runs the install command, with a GUI password prompt from pkexec. */
export function runNativeInstall(command: string[], timeoutMs = 10 * 60 * 1000): Promise<InstallResult> {
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn(command[0], command.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) {
      resolve({ ok: false, error: (e as Error).message })
      return
    }
    let stderr = ''
    const timer = setTimeout(() => {
      try { proc.kill() } catch { /* already gone */ }
      resolve({ ok: false, error: 'installazione interrotta: tempo scaduto' })
    }, timeoutMs)
    proc.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000) })
    proc.on('error', (e) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        error: e.message.includes('ENOENT')
          ? 'pkexec non trovato: installa polkit oppure esegui manualmente il comando mostrato nelle impostazioni'
          : e.message
      })
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ ok: true, restartRequired: true })
      else resolve({ ok: false, error: stderr.trim().split('\n').slice(-3).join('\n') || `installazione terminata con codice ${code ?? '?'}` })
    })
  })
}
