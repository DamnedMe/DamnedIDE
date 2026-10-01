import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readFileSync } from 'fs'
import { join } from 'path'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
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
  // human-readable instruction shown by the settings panel for managed builds
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
 * Owns the OTA lifecycle and exposes it to the renderer: credentials-free GitHub
 * provider, auto-download, periodic checks, plus a manual `update:check` that the
 * settings panel can trigger. State is broadcast on `update:state` so the UI can
 * show "verifica in corso / aggiornato / scarico la X / pronta".
 *
 * Native Linux packages (deb/pacman/rpm) are CHECK-ONLY. electron-updater would
 * otherwise download the AppImage — the GitHub feed carries no pacman/deb file —
 * and install it on quit through a SYNCHRONOUS `spawnSync(sudo/pkexec …)`: the
 * main process blocks on the password prompt inside the `quit` event, so the
 * window closes but the app never exits. Distro packages are updated with
 * `pacman -U` / `apt install` (the settings panel says so), never by the IDE.
 */
export class UpdateService {
  private current: UpdateState
  private target: () => BrowserWindow | null
  private readonly packageType: LinuxPackageType
  // true when the update must be installed by the distro package manager
  private readonly managed: boolean

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
      // distro packages are installed by pacman/apt: quitting here would block
      // on a synchronous sudo/pkexec prompt and leave the process alive
      if (this.managed) return false
      autoUpdater.quitAndInstall(false, true)
      return true
    })
  }

  async check(): Promise<void> {
    if (!app.isPackaged) return
    try {
      this.set({ status: 'checking', error: undefined })
      await autoUpdater.checkForUpdates()
    } catch (e) {
      this.set({ status: 'error', error: (e as Error).message })
    }
  }

  private start(): void {
    // Managed Linux builds (deb/pacman) only check: no download and, above all,
    // no install-on-quit (it spawns sudo synchronously inside the quit event).
    autoUpdater.autoDownload = !this.managed
    autoUpdater.autoInstallOnAppQuit = !this.managed
    autoUpdater.logger = null

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info) => this.set({ status: 'available', version: info.version }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'up-to-date', version: undefined, progress: undefined }))
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', progress: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'downloaded', version: info.version, progress: 100 })
      try { this.target()?.webContents.send('update:downloaded') } catch { /* window closed */ }
    })
    autoUpdater.on('error', (e) => {
      this.set({ status: 'error', error: e?.message })
      console.error('[updater]', e?.message)
    })

    // check on startup (with a short delay) and then periodically
    const check = () => this.check()
    setTimeout(check, 8000)
    setInterval(check, 30 * 60 * 1000)
  }
}
