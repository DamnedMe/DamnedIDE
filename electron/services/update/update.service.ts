import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { acquireInstanceLock, lockOwner, releaseInstanceLock } from '../process/instance-lock'
import {
  buildInstalledVersionQuery,
  feedCarriesPackage,
  installNativePackage,
  parseInstalledVersion,
  runCapture,
  sameVersion,
  type InstallResult
} from './linux-install'
import { createUpdateLog, type UpdateLog } from './update-log'

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
  // another IDE instance on this profile owns userData/updater.lock: this one
  // never checks, downloads or installs (they would share one pending cache)
  ownerElsewhere?: boolean
  // userData/logs/updater.log
  logPath?: string
  // managed only: version installed by the package manager, active after a restart
  pendingRestart?: string
}

export interface InstallLatestResult extends InstallResult {
  upToDate?: boolean
}

type LinuxPackageType = 'appimage' | 'deb' | 'pacman' | 'rpm' | 'unknown'

const OWNER_ELSEWHERE_ERROR = "un'altra finestra di DamnedIDE sta gestendo l'aggiornamento: usa quella o chiudila"
const MISSING_DOWNLOAD_ERROR = "il file dell'aggiornamento scaricato non c'è più (rimosso da un'altra finestra di DamnedIDE?): lo riscarico, riprova tra poco"

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
 * provider, auto-download, periodic checks, a manual `update:check` and a
 * one-click `update:installLatest` (check → download → install). State is
 * broadcast on `update:state`.
 *
 * One instance at a time: several IDE instances run on one profile and
 * electron-updater keeps ONE pending cache per app; an instance validating a
 * different update empties it under the other's feet (the installer it was about
 * to run disappears: ENOENT, "Impossibile trovare il file ...\pending\..."). So
 * only the instance holding `userData/updater.lock` configures autoUpdater at
 * all; the others report `ownerElsewhere` and retry the lock on every tick and
 * manual action (the owner may have quit). A non-owner never downloads, so it
 * never gets electron-updater's install-on-quit handler.
 *
 * Native Linux packages (deb/pacman/rpm): the CI adds the distro package to
 * latest-linux.yml, the IDE downloads it through electron-updater (only when the
 * feed really carries the matching file) and installs a /tmp copy with an ASYNC
 * `pkexec pacman -U`, then verifies the installed version (see linux-install.ts).
 * electron-updater's own Linux installer is never used: it spawns sudo/pkexec
 * synchronously inside the quit event and blocks the process on the password
 * prompt. When the feed has no package for this distro the settings panel falls
 * back to the manual hint.
 *
 * Everything worth knowing afterwards goes to userData/logs/updater.log.
 */
export class UpdateService {
  private current: UpdateState
  private target: () => BrowserWindow | null
  private readonly packageType: LinuxPackageType
  // true when the update is installed by the distro package manager (through pkexec)
  private readonly managed: boolean
  private readonly lockFile: string
  private readonly log: UpdateLog
  // this instance holds updater.lock
  private owner = false
  // autoUpdater options and listeners set (first time this instance became the owner)
  private configured = false
  // newer version found by the last check, null when none or unknown
  private available: UpdateInfo | null = null
  // file downloaded by electron-updater and the version it holds
  private downloadedFile: string | null = null
  private downloadedVersion: string | null = null
  private installing: Promise<InstallLatestResult> | null = null

  constructor(target: () => BrowserWindow | null) {
    this.target = target
    this.packageType = detectLinuxPackageType()
    this.managed = app.isPackaged && process.platform === 'linux' && this.packageType !== 'appimage'
    const userData = app.getPath('userData')
    this.lockFile = join(userData, 'updater.lock')
    this.log = createUpdateLog(join(userData, 'logs', 'updater.log'))
    this.current = {
      packaged: app.isPackaged,
      currentVersion: app.getVersion(),
      status: 'idle',
      managed: this.managed,
      installHint: this.managed ? installHintFor(this.packageType) : undefined,
      logPath: this.log.path
    }
    this.registerIpc()
    if (app.isPackaged) this.start()
  }

  getState(): UpdateState {
    return this.current
  }

  /**
   * Frees updater.lock for the next instance: on will-quit, and on a Windows
   * shutdown / logoff (window 'session-end'), where will-quit is not emitted.
   */
  releaseLock(): void {
    releaseInstanceLock(this.lockFile)
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
    ipcMain.handle('update:installLatest', () => this.installLatest())
    ipcMain.handle('update:restart', () => {
      this.log.info('riavvio richiesto dalle impostazioni')
      app.relaunch()
      app.quit()
    })
  }

  private start(): void {
    this.log.info(`avvio v${app.getVersion()} (${process.platform}${process.platform === 'linux' ? `, pacchetto ${this.packageType}` : ''})`)
    app.on('before-quit', () => this.guardQuitInstall())
    app.on('will-quit', () => this.releaseLock())
    try { mkdirSync(app.getPath('userData'), { recursive: true }) } catch { /* acquire reports it */ }
    this.ensureOwner()

    // check on startup (with a short delay) and then periodically; a non-owner
    // tries to take the lock over on every tick
    const check = () => { void this.check() }
    setTimeout(check, 8000)
    setInterval(check, 30 * 60 * 1000)
  }

  /** Takes updater.lock when it is free or its owner is gone; only the owner touches autoUpdater. */
  private ensureOwner(): boolean {
    const owned = acquireInstanceLock(this.lockFile)
    const first = this.current.ownerElsewhere === undefined
    if (first || owned !== this.owner) {
      this.log.info(owned
        ? `questa istanza (pid ${process.pid}) gestisce gli aggiornamenti`
        : `aggiornamenti gestiti da un'altra istanza (pid ${lockOwner(this.lockFile)?.pid ?? '?'}): questa non fa nulla`)
    }
    if (owned) {
      if (!this.configured) this.configure()
      else if (!this.owner) autoUpdater.autoInstallOnAppQuit = !this.managed
    } else if (this.owner) {
      // lost the lock: no install at quit from a cache another instance now manages
      autoUpdater.autoInstallOnAppQuit = false
    }
    this.owner = owned
    if (first || this.current.ownerElsewhere !== !owned) this.set({ ownerElsewhere: !owned })
    return owned
  }

  private configure(): void {
    this.configured = true
    // Managed Linux builds download the native package manually in check()
    // (only when the feed carries it) and install it with pkexec; the automatic
    // electron-updater install on quit stays disabled for them.
    autoUpdater.autoDownload = !this.managed
    autoUpdater.autoInstallOnAppQuit = !this.managed
    autoUpdater.logger = this.log

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info) => {
      this.available = info
      this.log.info(`disponibile la ${info.version} (installata ${app.getVersion()})`)
      this.set({ status: 'available', version: info.version })
    })
    autoUpdater.on('update-not-available', () => {
      this.available = null
      this.set({ status: 'up-to-date', version: undefined, progress: undefined })
    })
    // a download that goes on (again) clears the error of an earlier attempt, e.g. the
    // missing cached file that missingDownload() re-downloads
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', progress: Math.round(p.percent), error: undefined }))
    autoUpdater.on('update-downloaded', (info) => {
      this.downloadedFile = info.downloadedFile || null
      this.downloadedVersion = info.version
      // an install on quit skipped for a missing file is back with the fresh download
      if (!this.managed && this.owner) autoUpdater.autoInstallOnAppQuit = true
      this.log.info(`scaricata la ${info.version}: ${info.downloadedFile}`)
      this.set({ status: 'downloaded', version: info.version, progress: 100, error: undefined })
    })
    autoUpdater.on('error', (e) => {
      this.log.error(`errore: ${e?.stack || e?.message || e}`)
      this.failState(e)
    })
  }

  private failState(e: unknown): void {
    this.set({ status: 'error', error: updateErrorMessage(e, this.managed, this.current.installHint) })
  }

  /** Periodic tick and manual "verifica aggiornamenti". */
  async check(): Promise<void> {
    if (!app.isPackaged || this.current.pendingRestart || this.installing) return
    if (!this.ensureOwner()) return
    try {
      await this.runCheck()
    } catch (e) {
      this.failState(e) // logged by the 'error' listener
    }
  }

  /** Owner only. Returns the newer version, null when up to date. */
  private async runCheck(): Promise<UpdateInfo | null> {
    this.set({ status: 'checking', error: undefined })
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      this.set({ status: 'idle' })
      return null
    }
    const info = result.isUpdateAvailable ? result.updateInfo : null
    // electron-updater compares with the version THIS process runs: another window may
    // already have installed it through the package manager (restart pending, no reinstall)
    if (info && await this.installedByPackageManager(info.version)) {
      this.available = null
      this.set({ status: 'idle', version: info.version, progress: undefined, pendingRestart: info.version })
      return null
    }
    this.available = info
    if (this.managed && info) this.startManagedDownload(info)
    return info
  }

  /** Managed Linux only: true when the distro package already is `version` (unprivileged query). */
  private async installedByPackageManager(version: string): Promise<boolean> {
    const type = this.packageType
    if (!this.managed || (type !== 'pacman' && type !== 'deb' && type !== 'rpm')) return false
    const query = buildInstalledVersionQuery(type)
    const run = await runCapture(query, 30_000)
    const found = parseInstalledVersion(type, run.stdout)
    if (!found || !sameVersion(found, version)) return false
    this.log.info(`la ${version} è già installata (${query.join(' ')} → ${found}, questa istanza è la ${app.getVersion()}): basta riavviare`)
    return true
  }

  /**
   * Downloads the native package only when the feed actually carries it: calling
   * electron-updater blindly would crash in PacmanUpdater when the .pacman file
   * is missing from latest-linux.yml.
   */
  private startManagedDownload(info: UpdateInfo): void {
    if (!feedCarriesPackage(info.files, this.packageType)) {
      this.log.warn(`il feed della ${info.version} non contiene il pacchetto .${this.packageType}: aggiornamento manuale`)
      // keep the actionable manual hint shown by the settings panel
      this.set({ selfInstall: false, installHint: installHintFor(this.packageType) })
      return
    }
    this.set({ selfInstall: true })
    void autoUpdater.downloadUpdate().catch(e => this.failState(e))
  }

  /** One click: take the lock, check if needed, download if needed, install. */
  installLatest(): Promise<InstallLatestResult> {
    if (!this.installing) this.installing = this.doInstallLatest().finally(() => { this.installing = null })
    return this.installing
  }

  private async doInstallLatest(): Promise<InstallLatestResult> {
    if (!app.isPackaged) return { ok: false, error: "versione di sviluppo: gli aggiornamenti si installano solo nell'app installata" }
    if (this.current.pendingRestart) return { ok: true, restartRequired: true }
    if (!this.ensureOwner()) return { ok: false, error: OWNER_ELSEWHERE_ERROR }
    try {
      const info = this.available ?? await this.runCheck()
      // another window already installed it with the package manager: only a restart is missing
      if (!info && this.current.pendingRestart) return { ok: true, restartRequired: true }
      if (!info) return { ok: true, upToDate: true }
      if (this.managed && !feedCarriesPackage(info.files, this.packageType)) {
        return { ok: false, error: this.current.installHint || installHintFor(this.packageType) }
      }
      this.log.info(`installa l'ultima versione: ${app.getVersion()} → ${info.version}`)
      const file = await this.ensureDownloaded(info.version)
      if (this.managed) return await this.installManaged(info.version)
      // Windows / macOS / AppImage: electron-updater installs from its cache
      if (!existsSync(file)) return this.missingDownload(file)
      this.log.info(`quitAndInstall: ${file}`)
      this.set({ status: 'installing', error: undefined })
      autoUpdater.quitAndInstall(false, true)
      // electron-updater reports a refused install (no installer path, a doInstall throw)
      // through a synchronous 'error' event, already in the state: not a success
      if (this.current.status === 'error') {
        return { ok: false, error: this.current.error || 'installazione non avviata — vedi il log aggiornamenti' }
      }
      return { ok: true }
    } catch (e) {
      this.log.error(`installazione dell'ultima versione non riuscita: ${(e as Error)?.message || e}`)
      this.failState(e)
      return { ok: false, error: updateErrorMessage(e, this.managed, this.current.installHint) }
    }
  }

  /** Path of the downloaded update for `version`, downloading it (again) when missing. */
  private async ensureDownloaded(version: string): Promise<string> {
    const file = this.downloadedFile
    if (file && this.downloadedVersion === version && existsSync(file)) return file
    if (file && !existsSync(file)) this.log.warn(`il file scaricato ${file} non esiste più: lo riscarico`)
    const paths = await autoUpdater.downloadUpdate()
    const downloaded = this.downloadedFile && existsSync(this.downloadedFile) ? this.downloadedFile : paths?.[0]
    if (!downloaded || !existsSync(downloaded)) {
      throw new Error("scaricamento dell'aggiornamento non riuscito: il file non c'è — vedi il log aggiornamenti")
    }
    return downloaded
  }

  /** Never install from a cached file that is gone: re-download and say so. */
  private missingDownload(file: string): InstallLatestResult {
    this.log.warn(`installazione annullata: ${file} non esiste più — lo riscarico`)
    this.downloadedFile = null
    if (!this.managed) autoUpdater.autoInstallOnAppQuit = false
    this.set({ status: 'error', error: MISSING_DOWNLOAD_ERROR })
    void autoUpdater.downloadUpdate().catch(e => this.failState(e))
    return { ok: false, error: MISSING_DOWNLOAD_ERROR }
  }

  /**
   * Quit-time install (Windows/mac, electron-updater's quit handler): skip it when
   * the cached installer is gone, instead of the "file not found" dialog.
   */
  private guardQuitInstall(): void {
    if (!this.configured || this.managed || !this.downloadedFile) return
    if (existsSync(this.downloadedFile)) return
    autoUpdater.autoInstallOnAppQuit = false
    this.log.warn(`uscita: ${this.downloadedFile} non esiste più, nessuna installazione all'uscita`)
  }

  /** Privileged install of the downloaded native package (polkit prompts), verified. */
  private async installManaged(version: string): Promise<InstallLatestResult> {
    const type = this.packageType
    if (type !== 'pacman' && type !== 'deb' && type !== 'rpm') {
      return { ok: false, error: 'formato di pacchetto non supportato per l\'aggiornamento automatico' }
    }
    const file = this.downloadedFile
    if (!file || !existsSync(file)) return this.missingDownload(file ?? '(nessun file)')
    this.set({ status: 'installing', error: undefined })
    const result = await installNativePackage({ type, file, targetVersion: version, log: this.log })
    if (!result.ok) {
      this.log.error(`installazione della ${version} non riuscita: ${result.error}`)
      this.set({ status: 'downloaded', error: result.error })
      return result
    }
    this.log.info(`installata la ${version}: attiva dopo il riavvio`)
    this.available = null
    this.set({ status: 'idle', version, progress: undefined, error: undefined, pendingRestart: version })
    return result
  }
}
