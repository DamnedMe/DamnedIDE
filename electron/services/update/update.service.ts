import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

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
}

/**
 * Owns the OTA lifecycle and exposes it to the renderer: credentials-free GitHub
 * provider, auto-download, periodic checks, plus a manual `update:check` that the
 * settings panel can trigger. State is broadcast on `update:state` so the UI can
 * show "verifica in corso / aggiornato / scarico la X / pronta".
 */
export class UpdateService {
  private current: UpdateState
  private target: () => BrowserWindow | null

  constructor(target: () => BrowserWindow | null) {
    this.target = target
    this.current = {
      packaged: app.isPackaged,
      currentVersion: app.getVersion(),
      status: 'idle'
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
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
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
