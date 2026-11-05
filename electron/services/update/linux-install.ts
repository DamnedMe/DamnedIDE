import { spawn, type ChildProcess } from 'child_process'
import { chmod, copyFile, mkdtemp, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import type { UpdateLog } from './update-log'

// Native Linux package update: download through electron-updater (the CI adds
// the .pacman file to the feed) and install it with an async privileged command,
// the same approach GitTree uses. Never electron-updater's own Linux installer:
// that one spawns sudo/pkexec synchronously inside the quit event and blocks the
// process on the password prompt.
// No electron import: the pure helpers are exercised by scripts/linux-update-install.check.ts.

export type NativePackageType = 'pacman' | 'deb' | 'rpm'

/** Name of the installed distro package (= package.json `name`). */
export const NATIVE_PACKAGE_NAME = 'damned-ide'

const PACMAN = '/usr/bin/pacman'

export interface NativeInstallOptions {
  pkexec?: string
  /** pacman only: pass `--disable-sandbox` (exists only on some pacman versions, see pacmanSupportsDisableSandbox) */
  disableSandbox?: boolean
}

/**
 * Privileged install command for a downloaded native package (a copy staged in
 * /tmp, see stagePackage).
 * - pacman: `--overwrite *` for files left behind by a previous package,
 *   `--disable-sandbox` only when this pacman knows the flag.
 * - deb/rpm: the distro tools through pkexec.
 */
export function buildNativeInstallCommand(packageType: NativePackageType, packagePath: string, options: NativeInstallOptions = {}): string[] {
  const pkexec = options.pkexec || '/usr/bin/pkexec'
  switch (packageType) {
    case 'pacman':
      return [pkexec, PACMAN, '-U', '--noconfirm', ...(options.disableSandbox ? ['--disable-sandbox'] : []), '--overwrite', '*', packagePath]
    case 'deb':
      return [pkexec, 'dpkg', '-i', packagePath]
    case 'rpm':
      return [pkexec, 'rpm', '-Uvh', packagePath]
  }
}

/** What to run by hand when the IDE cannot install (no pkexec). */
export function manualInstallCommand(packageType: NativePackageType, packagePath: string): string {
  switch (packageType) {
    case 'pacman': return `sudo pacman -U --overwrite '*' ${packagePath}`
    case 'deb': return `sudo dpkg -i ${packagePath}`
    case 'rpm': return `sudo rpm -Uvh ${packagePath}`
  }
}

/**
 * True when `pacman -Uh` lists the plain `--disable-sandbox` flag (pacman 7.0);
 * older pacman rejects it, and `--disable-sandbox-filesystem` & co. are other flags.
 */
export function pacmanSupportsDisableSandbox(helpText: string): boolean {
  return /(^|\s)--disable-sandbox(?![\w-])/m.test(helpText)
}

/** Unprivileged query of the installed package version, run after the install to verify it. */
export function buildInstalledVersionQuery(packageType: NativePackageType): string[] {
  switch (packageType) {
    case 'pacman': return [PACMAN, '-Q', NATIVE_PACKAGE_NAME]
    case 'deb': return ['dpkg-query', '-W', '-f=${Version}', NATIVE_PACKAGE_NAME]
    case 'rpm': return ['rpm', '-q', '--qf', '%{VERSION}', NATIVE_PACKAGE_NAME]
  }
}

const VERSION_TOKEN = /^\d[\w.:~+-]*$/

/**
 * Version printed by buildInstalledVersionQuery, null when the package is not
 * installed (pacman: `damned-ide 0.0.22-1`; dpkg-query/rpm: the bare version;
 * rpm prints "package damned-ide is not installed" on stdout).
 */
export function parseInstalledVersion(packageType: NativePackageType, stdout: string): string | null {
  const out = (stdout || '').trim()
  if (!out) return null
  if (packageType === 'pacman') {
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2 && parts[0] === NATIVE_PACKAGE_NAME && VERSION_TOKEN.test(parts[1])) return parts[1]
    }
    return null
  }
  return VERSION_TOKEN.test(out) ? out : null
}

function normalizeVersion(v: string): string {
  return (v || '').trim().replace(/^v/i, '').replace(/^\d+:/, '').replace(/_/g, '-')
}

/**
 * Installed package version vs the release version: ignores the epoch, a `v`
 * prefix, the package release suffix (pacman/deb `0.0.22-1`) and the `_` that
 * pacman/rpm use instead of `-` in pre-release versions.
 */
export function sameVersion(installed: string, target: string): boolean {
  const a = normalizeVersion(installed)
  const b = normalizeVersion(target)
  if (!a || !b) return false
  return a === b || a.replace(/-\d+$/, '') === b
}

/** True when the update feed carries the package for this distro (electron-updater crashes otherwise). */
export function feedCarriesPackage(files: Array<{ url?: string }> | undefined, packageType: string): boolean {
  const expected = `.${packageType.toLowerCase()}`
  return Array.isArray(files) && files.some(file => typeof file?.url === 'string' && file.url.toLowerCase().endsWith(expected))
}

/** Last non-empty lines of a command output. */
export function outputTail(output: string, lines = 3): string {
  return (output || '').split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean).slice(-lines).join('\n')
}

/** pkexec: 126 = password dialog dismissed, 127 = not authorized / authentication failed. */
export function installFailureMessage(code: number | null, output: string): string {
  if (code === 126) return 'installazione annullata: la richiesta della password è stata chiusa'
  if (code === 127) return 'autorizzazione non concessa da pkexec (password errata o polkit non disponibile) — vedi il log aggiornamenti'
  return outputTail(output) || `installazione terminata con codice ${code ?? '?'} — vedi il log aggiornamenti`
}

export interface InstallResult {
  ok: boolean
  error?: string
  restartRequired?: boolean
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  /** spawn failure or timeout */
  error?: string
  notFound?: boolean
}

const MAX_CAPTURE = 64 * 1024

/** Runs a command without a shell, capturing stdout and stderr (tails). */
export function runCapture(command: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timer: NodeJS.Timeout | undefined
    let settled = false
    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    let proc: ChildProcess
    try {
      proc = spawn(command[0], command.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      finish({ code: null, stdout, stderr, error: (e as Error).message })
      return
    }
    timer = setTimeout(() => {
      try { proc.kill() } catch { /* already gone */ }
      finish({ code: null, stdout, stderr, error: 'tempo scaduto' })
    }, timeoutMs)
    proc.stdout?.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-MAX_CAPTURE) })
    proc.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-MAX_CAPTURE) })
    proc.on('error', (e: NodeJS.ErrnoException) => finish({ code: null, stdout, stderr, error: e.message, notFound: e.code === 'ENOENT' }))
    proc.on('close', (code) => finish({ code, stdout, stderr }))
  })
}

/**
 * Copies the downloaded package into a fresh /tmp dir (0755, file 0644): root and
 * pacman's sandbox can read /tmp, not always the user's ~/.cache.
 */
export async function stagePackage(file: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'damned-ide-update-'))
  await chmod(dir, 0o755)
  const staged = join(dir, basename(file))
  await copyFile(file, staged)
  await chmod(staged, 0o644)
  return { dir, file: staged }
}

/**
 * Privileged install of a downloaded native package, then verification that the
 * package manager really installed `targetVersion` (exit 0 is not enough: the
 * user got stuck on the old version without any sign of it).
 */
export async function installNativePackage(opts: {
  type: NativePackageType
  file: string
  targetVersion: string
  log: UpdateLog
  timeoutMs?: number
}): Promise<InstallResult> {
  const { type, file, targetVersion, log } = opts
  const pkexec = existsSync('/usr/bin/pkexec') ? '/usr/bin/pkexec' : 'pkexec'
  let staged: { dir: string; file: string }
  try {
    staged = await stagePackage(file)
  } catch (e) {
    log.error(`copia del pacchetto in /tmp non riuscita: ${(e as Error).message}`)
    return { ok: false, error: `impossibile preparare il pacchetto per l'installazione: ${(e as Error).message}` }
  }
  try {
    let disableSandbox = false
    if (type === 'pacman') {
      const help = await runCapture([PACMAN, '-Uh'], 15_000)
      disableSandbox = pacmanSupportsDisableSandbox(help.stdout + '\n' + help.stderr)
    }
    const command = buildNativeInstallCommand(type, staged.file, { pkexec, disableSandbox })
    log.info(`installazione ${targetVersion}: ${command.join(' ')}`)
    const run = await runCapture(command, opts.timeoutMs ?? 10 * 60 * 1000)
    const output = [run.stdout, run.stderr].filter(s => s.trim()).join('\n')
    log.info(`installazione terminata: codice ${run.code ?? '?'}${run.error ? ` (${run.error})` : ''}`)
    if (output.trim()) log.info(`output (coda):\n${outputTail(output, 40)}`)
    if (run.notFound) {
      return { ok: false, error: `pkexec non trovato: installa polkit oppure esegui ${manualInstallCommand(type, file)}` }
    }
    if (run.error) return { ok: false, error: `installazione interrotta: ${run.error}` }
    if (run.code !== 0) return { ok: false, error: installFailureMessage(run.code, output) }

    const query = buildInstalledVersionQuery(type)
    const check = await runCapture(query, 30_000)
    const found = parseInstalledVersion(type, check.stdout)
    log.info(`verifica: ${query.join(' ')} → ${found ?? `nessuna versione (${outputTail(check.stderr || check.error || '', 1) || `codice ${check.code ?? '?'}`})`}`)
    if (!found || !sameVersion(found, targetVersion)) {
      return { ok: false, error: `il gestore pacchetti non ha installato la ${targetVersion} (installata: ${found ?? 'nessuna'}) — vedi il log aggiornamenti` }
    }
    return { ok: true, restartRequired: true }
  } finally {
    await rm(staged.dir, { recursive: true, force: true }).catch(() => { /* tmp cleanup is best effort */ })
  }
}
