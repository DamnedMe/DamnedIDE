import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { buildNativeInstallCommand, runNativeInstall, type InstallResult, type NativePackageType } from './linux-install'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'up-to-date'
  | 'error'

export interface UpdateState {
  // false in dev: electron-updater only works on an installed build
  packaged: boolean
  currentVersion: string
  status: UpdateStatus
  // remote version, when known
  version?: string
  // 0-100 while downloading
  progress?: number
  error?: string
  // native Linux package (deb/pacman): the update is installed with the
  // distribution package manager, never by electron-updater
  managed?: boolean
  // managed only: true when the feed carries the package, so the IDE can
  // download it and install it itself (pkexec)
  selfInstall?: boolean
  // human-readable instruction shown by the settings panel when the update
  // cannot be installed by the IDE
  installHint?: string
}

type LinuxPackageType = 'appimage' | 'deb' | 'pacman' | 'rpm' | 'unknown'

/**
 * Package format of the running Linux build, from the `package-type` file the
 * packager writes in `resources/` (see scripts/after-pack.cjs).
 */
function detectLinuxPackageType(): LinuxPackageType {
  if (process.platform !== 'linux') return 'unknown'
  if (process.env.APPIMAGE) return 'appimage'
  try {
    const value = readFileSync(join(process.resourcesPath, 'package-type'), 'utf-8').trim().toLowerCase()
    if (value === 'appimage' || value === 'deb' || value === 'pacman' || value === 'rpm') return value
  } catch { /* dev build or label missing */ }
  return 'unknown'
}

function installHintFor(type: LinuxPackageType): string {
  const name = type === 'unknown' ? 'il gestore pacchetti della distribuzione' : type
  return `installa la nuova versione con il gestore pacchetti (${name}), non dall'IDE`
}

/**
 * Raw electron-updater failures must never reach the settings panel as a JS
 * TypeError. The classic one is `Cannot read properties of undefined (reading
 * 'info')`: a feed without the matching package makes `findFile` return
 * undefined and `AppUpdater.executeDownload` dereferences it. We avoid that by
 * downloading only when the feed carries the package, but the message stays
 * actionable if it ever comes back.
 */
function updateErrorMessage(e: unknown, managed: boolean, installHint?: string): string {
  const msg = (e as Error)?.message || String(e)
  if (/reading 'info'/.test(msg)) {
    return managed
      ? `questo pacchetto non si aggiorna dall'IDE — ${installHint || 'aggiorna con il gestore pacchetti'}`
      : "il file di aggiornamento non è presente nel feed GitHub — scarica la nuova versione dalla pagina delle release"
  }
  return msg
}

/**
 * Owns the OTA lifecycle and exposes it to the renderer: credentials-free GitHub
 * provider, auto-download, periodic checks, plus a manual `update:check` that the
 * settings panel can trigger. State is broadcast on `update:state` so the UI can
 * show "verifica in corso / aggiornato / scarico la X / pronta".
 *
 * Native Linux packages (deb/pacman/rpm): the CI adds the distro package to
 * latest-linux.yml, the IDE downloads it through electron-updater (only when the
 * feed really carries the matching file) and installs it with an ASYNC
 * `pkexec pacman -U` (see linux-install.ts). electron-updater's own Linux
 * installer is never used: it spawns sudo/pkexec synchronously inside the quit
 * event and blocks the process on the password prompt. When the feed has no
 * package for this distro the settings panel falls back to the manual hint.
 */
export class UpdateService {
  private current: UpdateState
  private target: () => BrowserWindow | null
  private readonly packageType: LinuxPackageType
  // true when the update is installed by the distro package manager (through pkexec)
  private readonly managed: boolean
  // file downloaded by electron-updater, ready for the privileged install
  private downloadedFile: string | null = null

  constructor(target: () => BrowserWindow | null) {
    this.target = target
    this.packageType = detectLinuxPackageType()
    this.managed = app.isPackaged && process.platform === 'linux' && this.packageType !== 'appimage'
    this.current = {
      packaged: app.isPackaged,
      currentVersion: app.getVersion(),
      status: 'idle',
      managed: this.managed,
      installHint: this.managed ? installHintFor(this.packageType) : undefined
    }
    this.registerIpc()
    if (app.isPackaged) this.start()
  }

  getState(): UpdateState {
    return this.current
  }

  private emit(): void {
    try { this.target()?.webContents.send('update:state', this.current) } catch { /* window closed */ }
  }

  private set(patch: Partial<UpdateState>): void {
    this.current = { ...this.current, ...patch }
    this.emit()
  }

  private registerIpc(): void {
    ipcMain.handle('update:state', () => this.current)
    ipcMain.handle('update:check', async () => {
      if (!app.isPackaged) return this.current
      await this.check()
      return this.current
    })
    ipcMain.handle('update:install', () => {
      // Native packages: async pkexec install, never electron-updater's sync
      // sudo path (it would block the quit on the password prompt).
      if (this.managed) return this.installManaged()
      autoUpdater.quitAndInstall(false, true)
      return { ok: true }
    })
  }

  async check(): Promise<void> {
    if (!app.isPackaged) return
    try {
      this.set({ status: 'checking', error: undefined })
      const result = await autoUpdater.checkForUpdates()
      if (this.managed && result && 'isUpdateAvailable' in result && result.isUpdateAvailable) {
        this.startManagedDownload(result.updateInfo)
      }
    } catch (e) {
      this.set({ status: 'error', error: updateErrorMessage(e, this.managed, this.current.installHint) })
    }
  }

  /**
   * Downloads the native package only when the feed actually carries it: calling
   * electron-updater blindly would crash in PacmanUpdater when the .pacman file
   * is missing from latest-linux.yml.
   */
  private startManagedDownload(info: { files?: Array<{ url?: string }> }): void {
    const expected = `.${this.packageType}`
    const hasArtifact = Array.isArray(info?.files) && info.files.some(file => file?.url?.toLowerCase().endsWith(expected))
    if (!hasArtifact) {
      // keep the actionable manual hint shown by the settings panel
      this.set({ selfInstall: false, installHint: installHintFor(this.packageType) })
      return
    }
    this.set({ selfInstall: true })
    void autoUpdater.downloadUpdate().catch(e => {
      this.set({ status: 'error', error: updateErrorMessage(e, this.managed, this.current.installHint) })
    })
  }

  /** Privileged install of the downloaded native package (polkit prompts). */
  private async installManaged(): Promise<InstallResult> {
    const type = this.packageType
    if (type !== 'pacman' && type !== 'deb' && type !== 'rpm') {
      return { ok: false, error: 'formato di pacchetto non supportato per l\'aggiornamento automatico' }
    }
    const file = this.downloadedFile
    if (!file || !existsSync(file)) {
      return { ok: false, error: 'pacchetto scaricato non trovato: riprova la verifica aggiornamenti' }
    }
    const pkexec = existsSync('/usr/bin/pkexec') ? '/usr/bin/pkexec' : 'pkexec'
    this.set({ status: 'installing', error: undefined })
    const result = await runNativeInstall(buildNativeInstallCommand(type as NativePackageType, file, pkexec))
    if (!result.ok) {
      this.set({ status: 'downloaded', error: result.error })
      return result
    }
    this.set({ status: 'idle', version: undefined, progress: undefined, error: undefined })
    return result
  }

  private start(): void {
    // Managed Linux builds download the native package manually in check()
    // (only when the feed carries it) and install it with pkexec; the automatic
    // electron-updater install on quit stays disabled for them.
    autoUpdater.autoDownload = !this.managed
    autoUpdater.autoInstallOnAppQuit = !this.managed
    autoUpdater.logger = null

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info) => this.set({ status: 'available', version: info.version }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'up-to-date', version: undefined, progress: undefined }))
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', progress: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => {
      this.downloadedFile = info.downloadedFile || null
      this.set({ status: 'downloaded', version: info.version, progress: 100 })
      try { this.target()?.webContents.send('update:downloaded') } catch { /* window closed */ }
    })
    autoUpdater.on('error', (e) => {
      this.set({ status: 'error', error: updateErrorMessage(e, this.managed, this.current.installHint) })
      console.error('[updater]', e?.message)
    })

    // check on startup (with a short delay) and then periodically
    const check = () => this.check()
    setTimeout(check, 8000)
    setInterval(check, 30 * 60 * 1000)
  }
}
