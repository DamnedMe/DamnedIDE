import { app, BrowserWindow, shell, ipcMain, dialog, clipboard, nativeImage, safeStorage, Notification } from 'electron'
import { join, normalize, extname } from 'path'
import { pathToFileURL } from 'url'
import { readdir, readFile, writeFile, stat, rm, mkdir } from 'fs/promises'
import { exec } from 'child_process'
import { GitService } from './services/git/git.service'
import { WorktreeService, cancelScheduledDeletes } from './services/git/worktree.service'
import { closeExplorerWindowsAt } from './services/process/windows-handles'
import { DiffService } from './services/git/diff.service'
import { AdoService, fetchRepositories } from './services/ado/ado.service'
import { AdoSettingsStore } from './services/ado/ado-settings.store'
import { PromotionChainService } from './services/ado/promotion-chain.service'
import { SqlService, SqlConnectionConfig, buildConnectionString, parseConnectionString } from './services/sql/sql.service'
import { SqlWorkspaceDocument, SqlWorkspaceService } from './services/sql/sql-workspace.service'
import { RoslynService } from './services/roslyn/roslyn.service'
import { createTerminal, writeToTerminal, resizeTerminal, destroyTerminal, destroyAllTerminals, destroyTerminalsUnderPath, TerminalType } from './services/terminal/terminal.service'
import { startProcess, stopProcess, stopAllProcesses } from './services/process/process.service'
import { McpService, McpServerConfig } from './services/mcp/mcp.service'
import { ClaudeService, setApiKey, hasApiKey } from './services/ai/claude.service'
import { AgentService, AgentSendRequest, AgentProviderId } from './services/ai/agent.service'
import { UpdateService } from './services/update/update.service'
import { watchRoot, unwatchRoot, closeAllWatchers } from './services/watch/watch.service'
import { openTargetFromArgv, resolveOpenTarget, type OpenTarget } from './services/open/open-target'
import { findGitTree, launchGitTree, GITTREE_DOWNLOAD_URL } from './services/gitclient/gittree'
import { buildXlsx, type XlsxSheet } from './services/export/xlsx.service'
import { RemoteService } from './services/remote/remote.service'
import { loadSharedStorage, setSharedItem } from './services/storage/shared-storage'
import type { RemoteSqlConnection, RemoteScope, WorkspaceSnapshot } from '../src/shared/remote/protocol'
import { ADO_MISSING_PAT, type AdoConnectionInput, type AdoLegacyConnection, type AdoRepoList, type AdoRepoRef } from '../src/shared/adoSettings'
import { promotionConfigKey, type PromotionConfig } from '../src/shared/adoPromotion'
import { chainConnection, type ChainStartInput } from '../src/shared/adoChain'

let mainWindow: BrowserWindow | null = null
let roslynService: RoslynService | null = null
let mcpService: McpService | null = null
let claudeService: ClaudeService | null = null
let agentService: AgentService | null = null
let remoteService: RemoteService | null = null

// Linux: the xdg-desktop-portal file chooser can open behind the window and
// swallow input from the second call onward (electron#32857) — the "change main
// folder" dialog then looks frozen. Requiring a portal version that does not
// exist makes Electron fall back to the native GTK/KDE dialog.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('xdg-portal-required-version', '99')
}

// IPC wrapper: rejects with a clean one-line Error (no mssql stack trace) so the
// dev console does not flood with "Error occurred in handler for 'sql:...'".
/** The window that sent a request (main or detached), for dialog parents and event targets. */
function senderWindow(e: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender) ?? mainWindow
}

function ipc<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult
): (_e: Electron.IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> {
  return async (_e, ...args) => {
    try {
      return await fn(...args)
    } catch (err) {
      const msg = (err as Error)?.message || String(err)
      console.error(`[ipc] ${msg}`)
      const clean = new Error(msg)
      ;(clean as Error & { stack?: string | undefined }).stack = undefined
      throw clean
    }
  }
}

function appIcon(): Electron.NativeImage {
  // nativeImage only decodes ICO on Windows: on Linux/macOS passing the .ico
  // yields an empty image, so the window/taskbar icon silently disappears.
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const image = nativeImage.createFromPath(join(app.getAppPath(), 'resources', iconFile))
  return image.isEmpty() ? nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.png')) : image
}

// ─── Open with DamnedIDE (folder / .md from Explorer, `damned-ide <path>`) ────
let pendingOpenTarget: OpenTarget | null = null

function argvOpenTarget(argv: string[]): OpenTarget | null {
  return openTargetFromArgv(argv, { packaged: app.isPackaged, appPath: app.getAppPath() })
}

function sendOpenTarget(target: OpenTarget): void {
  const w = mainWindow
  if (!w) { pendingOpenTarget = target; return }
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', () => {
      try { w.webContents.send('app:openPath', target) } catch { /* closed */ }
    })
  } else {
    try { w.webContents.send('app:openPath', target) } catch { pendingOpenTarget = target }
  }
}

/** Send an event to every open renderer (main + detached windows). */
function sendToRenderer(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send(channel, payload) } catch { /* window closed */ }
  }
}

// Multiple instances are allowed on purpose (one per repository/project): no
// single-instance lock. A launch with a path ("Open with DamnedIDE", the
// installer's folder context menu, `damned-ide <path>`) opens that path in the
// new instance through the argv handling below.
//
// macOS: Finder "Open with" delivers the file through this event, not argv, and
// it can fire before the app is ready
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  const target = resolveOpenTarget(filePath)
  if (target) sendOpenTarget(target)
})

/** localStorage copy shared by every instance (services/storage/shared-storage.ts). */
function registerSharedStorageIpc(): void {
  const file = join(app.getPath('userData'), 'renderer-storage.json')
  // sync: the preload seeds localStorage before the renderer's stores read it
  ipcMain.on('storage:load', (e, local: Record<string, string>) => {
    try {
      e.returnValue = loadSharedStorage(file, local)
    } catch (err) {
      console.error('[storage] load failed:', (err as Error).message)
      e.returnValue = local
    }
  })
  ipcMain.on('storage:set', (_e, key: string, value: string | null) => {
    try {
      setSharedItem(file, key, value)
    } catch (err) {
      console.error('[storage] write failed:', (err as Error).message)
    }
  })
}

// ─── Azure DevOps settings (services/ado/ado-settings.store.ts) ──────────────
// Connections, repository per folder and release BE/FE live in userData, read
// fresh on every call (several instances share them). PATs are encrypted with
// safeStorage and only used here: the renderer picks a connection by id.
function registerAdoSettingsIpc(ado: AdoService): AdoSettingsStore {
  const store = new AdoSettingsStore(app.getPath('userData'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  })
  // repository catalog per connection; the key changes with org/project, so an
  // edit made by another instance is never served from a stale entry
  const catalog = new Map<string, Promise<AdoRepoList>>()
  const catalogKey = (c: { id: string; organization: string; project: string }) =>
    `${c.id}|${promotionConfigKey(c.organization, c.project)}`
  const dropCatalog = (id: string) => {
    for (const key of [...catalog.keys()]) if (key.startsWith(`${id}|`)) catalog.delete(key)
  }
  const repositoriesOf = (c: { id: string; organization: string; project: string }): Promise<AdoRepoList> => {
    const key = catalogKey(c)
    const cached = catalog.get(key)
    if (cached) return cached
    const token = store.token(c.id)
    if (!token) return Promise.resolve({ ok: false, error: ADO_MISSING_PAT })
    const pending: Promise<AdoRepoList> = fetchRepositories(c.organization, c.project, token).then(list => {
      // only answers are cached: a network or PAT error is retried on the next call
      if (!list.ok && catalog.get(key) === pending) catalog.delete(key)
      return list
    })
    catalog.set(key, pending)
    return pending
  }
  const changed = () => sendToRenderer('adoSettings:changed', null)

  ipcMain.handle('adoSettings:get', ipc(() => store.view()))
  // saved only when Azure DevOps answers with this org/project/PAT
  ipcMain.handle('adoSettings:saveConnection', ipc(async (input: AdoConnectionInput) => {
    const organization = String(input?.organization ?? '').trim()
    const project = String(input?.project ?? '').trim()
    if (!organization || !project) throw new Error('organization e project sono obbligatori')
    const typed = String(input?.token ?? '').trim()
    const token = typed || (input?.id ? store.token(input.id) : null)
    if (!token) throw new Error(input?.id ? ADO_MISSING_PAT : 'il PAT è obbligatorio per una nuova connessione')
    const list = await fetchRepositories(organization, project, token)
    if (!list.ok) throw new Error(list.error)
    const connection = store.saveConnection({ id: input?.id, organization, project, token: typed || undefined })
    dropCatalog(connection.id)
    catalog.set(catalogKey(connection), Promise.resolve(list))
    changed()
    return { connection, repos: list.repos }
  }))
  ipcMain.handle('adoSettings:test', ipc(async (id: string) => {
    const c = store.read().connections.find(x => x.id === id)
    if (!c) return { ok: false, error: 'connessione non trovata' } as AdoRepoList
    dropCatalog(id)
    return repositoriesOf(c)
  }))
  ipcMain.handle('adoSettings:removeConnection', ipc((id: string) => {
    store.removeConnection(id)
    dropCatalog(id)
    changed()
  }))
  ipcMain.handle('adoSettings:setFolder', ipc((key: string, ref: AdoRepoRef | null) => {
    store.setFolder(key, ref)
    changed()
  }))
  ipcMain.handle('adoSettings:setRelease', ipc((key: string, config: PromotionConfig | null) => {
    store.setRelease(key, config)
    changed()
  }))
  ipcMain.handle('adoSettings:catalog', ipc(async (force?: boolean) => {
    if (force) catalog.clear()
    const connections = store.read().connections
    const lists = await Promise.all(connections.map(c => repositoriesOf(c)))
    const out: Record<string, AdoRepoList> = {}
    connections.forEach((c, i) => { out[c.id] = lists[i] })
    return out
  }))
  ipcMain.handle('adoSettings:importLegacy', ipc((legacy: Record<string, AdoLegacyConnection>, promotion: Record<string, PromotionConfig>) => {
    const imported = store.importLegacy(legacy, promotion)
    if (imported) changed()
    return imported
  }))

  // the existing ado:* calls follow the connection picked here (last caller wins, as before)
  ipcMain.handle('ado:use', ipc((connectionId: string) => {
    const c = store.read().connections.find(x => x.id === connectionId)
    const token = c ? store.token(c.id) : null
    if (!c || !token) return false
    ado.use(c.organization, token)
    return true
  }))
  return store
}

// ─── Release chains develop → qa → prod (services/ado/promotion-chain.service.ts) ───
// Every instance lists, starts and cancels the chains (userData/ado-chains.json);
// only the one holding userData/ado-chains.lock polls them, every 30 s, with its
// own AdoService per connection (never the panels' singleton above).
function registerAdoChainIpc(store: AdoSettingsStore): PromotionChainService {
  const chains = new PromotionChainService({
    dir: app.getPath('userData'),
    credentials: (chain) => {
      const c = chainConnection(chain, store.read().connections)
      if (!c) return `connessione ${chain.organization}/${chain.project} non trovata: aggiungila in Impostazioni › Azure DevOps › Connessioni`
      const token = store.token(c.id)
      return token ? { organization: c.organization, token } : ADO_MISSING_PAT
    },
    changed: () => sendToRenderer('adoChain:changed', null),
    notify: (title, body) => {
      try {
        if (Notification.isSupported()) new Notification({ title, body, icon: appIcon() }).show()
      } catch (err) {
        console.error('[ado-chain] notification failed:', (err as Error).message)
      }
    }
  })
  ipcMain.handle('adoChain:list', ipc(() => chains.list()))
  ipcMain.handle('adoChain:start', ipc((input: ChainStartInput) => {
    const c = store.read().connections.find(x => x.id === input?.connectionId)
    if (!c) throw new Error('connessione Azure DevOps non trovata: è stata rimossa nel frattempo')
    if (!store.token(c.id)) throw new Error(ADO_MISSING_PAT)
    return chains.start(input, c)
  }))
  ipcMain.handle('adoChain:cancel', ipc((id: string) => chains.cancel(id)))
  ipcMain.handle('adoChain:remove', ipc((id: string) => chains.remove(id)))
  chains.startPolling()
  // the next instance takes the polling over
  app.on('will-quit', () => chains.stop())
  return chains
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e2e',
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const gitService = new GitService()
  const worktreeService = new WorktreeService({ closeExplorerWindows: closeExplorerWindowsAt })
  const diffService = new DiffService()
  const adoService = new AdoService()
  const sqlService = new SqlService()
  const sqlWorkspaceService = new SqlWorkspaceService(app.getPath('userData'))
  mcpService = new McpService()
  claudeService = new ClaudeService()
  agentService = new AgentService(claudeService)
  roslynService = new RoslynService()

  remoteService = new RemoteService({
    userDataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    platform: process.platform,
    git: gitService,
    worktree: worktreeService,
    diff: diffService,
    sql: sqlService
  })
  // Mirror remote-originated UI changes back into the renderer.
  remoteService.setApplyHandler((change) => sendToRenderer('remote:apply', change))
  for (const event of ['pairing-request', 'pairing-resolved', 'device-changed', 'log']) {
    remoteService.on(event, (payload: unknown) => sendToRenderer('remote:event', { event, payload }))
  }

  registerIpcHandlers(gitService, worktreeService, diffService, adoService, sqlService, sqlWorkspaceService, roslynService, mcpService, claudeService, agentService)
  registerRemoteIpc(remoteService)
  registerSharedStorageIpc()
  const chains = registerAdoChainIpc(registerAdoSettingsIpc(adoService))
  const fromArgv = argvOpenTarget(process.argv)
  if (fromArgv) pendingOpenTarget = fromArgv
  createWindow()
  // OTA: automatic checks + the manual "verifica aggiornamenti" in settings
  const updater = new UpdateService(() => mainWindow)
  // Windows shutdown / restart / logoff: before-quit and will-quit are not emitted, so the
  // one-owner locks (updater.lock, ado-chains.lock) are freed here for the next start
  mainWindow?.on('session-end', () => {
    chains.stop()
    updater.releaseLock()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// A single failing teardown step (a wedged pty, a CLI refusing to die, a
// watcher throwing) must never leave the process alive with no window: every
// step is isolated, so `app.quit()` is always reached.
function runCleanup(): void {
  const steps: [string, () => void][] = [
    ['terminals', destroyAllTerminals],
    ['processes', stopAllProcesses],
    ['roslyn', () => roslynService?.stop()],
    ['mcp', () => mcpService?.disconnectAll()],
    ['agents', () => agentService?.cancelAll()],
    ['remote', () => { remoteService?.stop(); remoteService?.dispose() }],
    ['watchers', closeAllWatchers],
    ['scheduled deletes', cancelScheduledDeletes]
  ]
  for (const [name, run] of steps) {
    try {
      run()
    } catch (err) {
      console.error(`[quit] ${name} cleanup failed:`, (err as Error)?.message || err)
    }
  }
}

app.on('window-all-closed', () => {
  runCleanup()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  // Any quit path (window-all-closed, update restart, app.quit) must tear down
  // running processes and terminals, otherwise spawned apps keep their ports.
  runCleanup()
})
function registerIpcHandlers(
  git: GitService,
  worktree: WorktreeService,
  diff: DiffService,
  ado: AdoService,
  sql: SqlService,
  sqlWorkspace: SqlWorkspaceService,
  roslyn: RoslynService,
  mcp: McpService,
  claude: ClaudeService,
  agent: AgentService
): void {
  // ─── Git ───────────────────────────────────────────
  ipcMain.handle('git:status', (_e, repoPath: string) => git.status(repoPath))
  ipcMain.handle('git:porcelain', (_e, repoPath: string) => git.porcelain(repoPath))
  ipcMain.handle('git:stage', (_e, repoPath: string, files: string[]) => git.stage(repoPath, files))
  ipcMain.handle('git:unstage', (_e, repoPath: string, files: string[]) => git.unstage(repoPath, files))
  ipcMain.handle('git:discardChanges', (_e, repoPath: string, file: string, opts: { staged?: boolean; untracked?: boolean }) =>
    git.discardChanges(repoPath, file, opts))
  ipcMain.handle('git:commit', (_e, repoPath: string, message: string) => git.commit(repoPath, message))
  ipcMain.handle('git:branches', (_e, repoPath: string) => git.branches(repoPath))
  ipcMain.handle('git:log', (_e, repoPath: string, count: number) => git.log(repoPath, count))
  ipcMain.handle('git:pull', (_e, repoPath: string) => git.pull(repoPath))
  ipcMain.handle('git:push', (_e, repoPath: string) => git.push(repoPath))
  ipcMain.handle('git:fetch', (_e, repoPath: string, opts?: { prune?: boolean }) => git.fetch(repoPath, opts))

  // ─── Worktree ──────────────────────────────────────
  ipcMain.handle('worktree:list', (_e, repoPath: string) => worktree.list(repoPath))
  ipcMain.handle('worktree:add', (_e, repoPath: string, branch: string, path: string, base?: string) =>
    worktree.add(repoPath, branch, path, base))
  ipcMain.handle('worktree:stack', (_e, repoPath: string) => worktree.stack(repoPath))
  ipcMain.handle('worktree:overview', (_e, repoPath: string, opts?: { paths?: string[]; localOnly?: boolean }) =>
    worktree.overview(repoPath, opts))
  ipcMain.handle('worktree:retargetChildren', (_e, repoPath: string, parentBranch: string) =>
    worktree.retargetChildren(repoPath, parentBranch))
  ipcMain.handle('worktree:clearLink', (_e, repoPath: string, branch: string) => worktree.clearLink(repoPath, branch))
  // promote a stacked branch: align it with develop (merge) then drop the link
  ipcMain.handle('worktree:promote', async (_e, repoPath: string, worktreePath: string) => {
    const merge = await git.merge(worktreePath, 'origin/develop')
    if (!merge.ok) return { ok: false, error: merge.message, conflicts: merge.conflicts }
    const branch = await git.currentBranch(worktreePath)
    if (branch) await worktree.clearLink(repoPath, branch)
    return { ok: true }
  })
  ipcMain.handle('worktree:remove', (_e, repoPath: string, worktreePath: string, force?: boolean) => {
    // a terminal rooted in the worktree keeps a handle on the folder on Windows:
    // on a forced removal close those first, otherwise rm/`worktree remove` fail
    if (force) destroyTerminalsUnderPath(worktreePath)
    return worktree.remove(repoPath, worktreePath, !!force)
  })
  // bulk cleanup: re-checks clean + no local-only commits right before deleting
  // (also on the forced retry, where terminals are closed only once the checks pass)
  ipcMain.handle('worktree:removeSafe', (_e, repoPath: string, worktreePath: string, force?: boolean) =>
    worktree.removeSafe(repoPath, worktreePath, force ? () => destroyTerminalsUnderPath(worktreePath) : undefined))
  ipcMain.handle('worktree:prune', (_e, repoPath: string) => worktree.prune(repoPath))

  // ─── Diff ──────────────────────────────────────────
  ipcMain.handle('diff:unstaged', (_e, repoPath: string, file: string) => diff.unstaged(repoPath, file))
  ipcMain.handle('diff:staged', (_e, repoPath: string, file: string) => diff.staged(repoPath, file))
  ipcMain.handle('diff:branch', (_e, repoPath: string, branchA: string, branchB: string) =>
    diff.branchDiff(repoPath, branchA, branchB))

  // ─── Azure DevOps (ado:use, which picks the connection, is in registerAdoSettingsIpc) ───
  ipcMain.handle('ado:workItems', (_e, project: string) => ado.getWorkItems(project))
  ipcMain.handle('ado:workItem', (_e, project: string, id: number) => ado.getWorkItem(project, id))
  ipcMain.handle('ado:workItemsBatch', (_e, project: string, ids: number[]) => ado.getWorkItemsBatch(project, ids))
  ipcMain.handle('ado:pullRequests', (_e, project: string, repo: string) => ado.getPullRequests(project, repo))
  ipcMain.handle('ado:pullRequestDetail', (_e, project: string, repo: string, prId: number) => ado.getPullRequestDetail(project, repo, prId))
  ipcMain.handle('ado:pullRequestFiles', (_e, project: string, repo: string, prId: number) => ado.getPullRequestFiles(project, repo, prId))
  ipcMain.handle('ado:fileContent', (_e, project: string, repo: string, path: string, commitId: string) => ado.getFileContent(project, repo, path, commitId))
  ipcMain.handle('ado:pullRequestThreads', (_e, project: string, repo: string, prId: number) => ado.getPullRequestThreads(project, repo, prId))
  ipcMain.handle('ado:branches', (_e, project: string, repo: string) => ado.getBranches(project, repo))
  ipcMain.handle('ado:repositories', (_e, project: string) => ado.getRepositories(project))
  // strict: an Azure DevOps error throws instead of reading as "no commit" (release chain preview)
  ipcMain.handle('ado:commitsBetween', (_e, project: string, repo: string, source: string, target: string, strict?: boolean) => ado.getCommitsBetween(project, repo, source, target, { strict: !!strict }))
  ipcMain.handle('ado:setVote', (_e, project: string, repo: string, prId: number, vote: number) => ado.setVote(project, repo, prId, vote))
  ipcMain.handle('ado:completePr', (_e, project: string, repo: string, prId: number, sourceCommitId: string, deleteSourceBranch?: boolean) => ado.completePr(project, repo, prId, sourceCommitId, deleteSourceBranch))
  ipcMain.handle('ado:createPr', (_e, project: string, repo: string, opts: { sourceRef: string; targetRef: string; title: string; description: string; autoComplete: boolean; deleteSourceBranch?: boolean; forceComplete?: boolean; workItemIds?: number[] }) => ado.createPullRequest(project, repo, opts))

  // ─── SQL Server ────────────────────────────────────
  ipcMain.handle('sql:connect', ipc((config: SqlConnectionConfig) => sql.connect(config)))
  ipcMain.handle('sql:disconnect', ipc((connectionId: string) => sql.disconnect(connectionId)))
  ipcMain.handle('sql:isConnected', (_e, connectionId: string) => sql.isConnected(connectionId))
  ipcMain.handle('sql:query', ipc((connectionId: string, query: string, queryId?: string, maxRows?: number, database?: string) =>
    sql.executeQuery(connectionId, query, queryId, maxRows, database)))
  ipcMain.handle('sql:cancelQuery', ipc((queryId: string) => sql.cancelQuery(queryId)))
  ipcMain.handle('sql:testConnection', ipc((config: SqlConnectionConfig) => sql.testConnection(config)))
  ipcMain.handle('sql:serverInfo', ipc((connectionId: string) => sql.getServerInfo(connectionId)))
  ipcMain.handle('sql:databases', ipc((connectionId: string) => sql.listDatabases(connectionId)))
  ipcMain.handle('sql:tables', ipc((connectionId: string, database: string) => sql.listTables(connectionId, database)))
  ipcMain.handle('sql:views', ipc((connectionId: string, database: string) => sql.listViews(connectionId, database)))
  ipcMain.handle('sql:procedures', ipc((connectionId: string, database: string) => sql.listStoredProcedures(connectionId, database)))
  ipcMain.handle('sql:functions', ipc((connectionId: string, database: string) => sql.listFunctions(connectionId, database)))
  ipcMain.handle('sql:columns', ipc((connectionId: string, database: string, table: string) =>
    sql.listColumns(connectionId, database, table)))
  ipcMain.handle('sql:objectDefinition', ipc((connectionId: string, database: string, objectName: string) =>
    sql.objectDefinition(connectionId, database, objectName)))
  ipcMain.handle('sql:diagram', ipc((connectionId: string, database: string, tables?: string[]) =>
    sql.getDiagram(connectionId, database, tables)))
  ipcMain.handle('sql:schemaSnapshot', ipc((connectionId: string, database: string) =>
    sql.getSchemaSnapshot(connectionId, database)))
  ipcMain.handle('sql:workspaceLoad', ipc(() => sqlWorkspace.load()))
  ipcMain.handle('sql:workspaceSave', ipc((workspace: SqlWorkspaceDocument) => sqlWorkspace.save(workspace)))
  ipcMain.handle('sql:buildConnectionString', ipc((config: SqlConnectionConfig) => buildConnectionString(config)))
  ipcMain.handle('sql:parseConnectionString', ipc((cs: string) => parseConnectionString(cs)))

  // ─── SQL backup / data-tier applications ───────────────────────────────
  ipcMain.handle('sql:defaultBackupDir', ipc((connectionId: string, database: string) => sql.defaultBackupDirectory(connectionId, database)))
  ipcMain.handle('sql:backup', ipc((connectionId: string, database: string, options: { path: string; compress: boolean; copyOnly: boolean; init: boolean }) =>
    sql.backupDatabase(connectionId, database, options)))
  ipcMain.handle('sql:sqlPackageInfo', () => sql.sqlPackageInfo())
  ipcMain.handle('sql:restore', ipc((connectionId: string, options: { path: string; database: string; replace: boolean }) =>
    sql.restoreDatabase(connectionId, options)))
  ipcMain.handle('sql:dataTier', (e, connectionId: string, database: string, action: 'extract' | 'export', targetFile: string) =>
    ipc(() => sql.dataTier(connectionId, database, action, targetFile, senderWindow(e)))(e))
  ipcMain.handle('sql:dataTierCancel', () => { sql.cancelDataTier() })

  // ─── Dialog ────────────────────────────────────────
  ipcMain.handle('dialog:openFolder', async (e) => {
    const result = await dialog.showOpenDialog(senderWindow(e)!, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:saveSqlQuery', async (e, defaultName: string, content: string) => {
    const safeName = (defaultName || 'query.sql').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '') || 'query.sql'
    const result = await dialog.showSaveDialog(senderWindow(e)!, {
      title: 'Save SQL query',
      defaultPath: safeName.toLocaleLowerCase().endsWith('.sql') ? safeName : `${safeName}.sql`,
      filters: [{ name: 'SQL query', extensions: ['sql'] }, { name: 'All files', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, content, 'utf-8')
    return result.filePath
  })

  ipcMain.handle('dialog:saveFile', async (e, defaultName: string, filters: { name: string; extensions: string[] }[]) => {
    const result = await dialog.showSaveDialog(senderWindow(e)!, {
      title: 'Salva con nome',
      defaultPath: defaultName,
      filters
    })
    return result.canceled || !result.filePath ? null : result.filePath
  })

  ipcMain.handle('dialog:openFile', async (e, title: string, filters: { name: string; extensions: string[] }[]) => {
    const result = await dialog.showOpenDialog(senderWindow(e)!, {
      title,
      properties: ['openFile'],
      filters
    })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })

  // The SQL results grid exports a real .xlsx (written here, no renderer library)
  ipcMain.handle('export:xlsx', async (e, defaultName: string, sheets: XlsxSheet[]) => {
    const safeName = (defaultName || 'query_results.xlsx').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '') || 'query_results.xlsx'
    const result = await dialog.showSaveDialog(senderWindow(e)!, {
      title: 'Esporta in Excel',
      defaultPath: safeName.toLocaleLowerCase().endsWith('.xlsx') ? safeName : `${safeName}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }, { name: 'All files', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePath) return null
    const file = result.filePath.toLocaleLowerCase().endsWith('.xlsx') ? result.filePath : `${result.filePath}.xlsx`
    await writeFile(file, buildXlsx((sheets || []).map(sheet => ({ name: sheet.name || 'Results', columns: sheet.columns || [], rows: sheet.rows || [] }))))
    return file
  })

  // ─── Filesystem ─────────────────────────────────────
  ipcMain.handle('fs:readDir', async (_e, dirPath: string) => {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries
      .filter(e => !e.name.startsWith('.') || e.name === '.gitignore')
      .map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile()
      }))
  })

  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    return readFile(filePath, 'utf-8')
  })

  ipcMain.handle('fs:writeFile', async (_e, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf-8')
  })

  ipcMain.handle('fs:delete', async (_e, targetPath: string) => {
    await rm(targetPath, { recursive: true, force: true })
  })

  ipcMain.handle('fs:mkdir', async (_e, dirPath: string) => {
    await mkdir(dirPath, { recursive: true })
  })

  ipcMain.handle('shell:openFolder', async (_e, folderPath: string) => {
    const normalized = normalize(folderPath)
    try {
      const result = await shell.openPath(normalized)
      if (result) console.error('[shell:openFolder] error:', result)
      return result
    } catch (err) {
      console.error('[shell:openFolder] exception:', err)
      return (err as Error).message
    }
  })

  ipcMain.handle('shell:showItemInFolder', (_e, itemPath: string) => {
    try { shell.showItemInFolder(normalize(itemPath)) } catch { /* invalid path */ }
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    await shell.openExternal(url)
  })

  // GitTree: external git client, opened on a working-tree root via its deep link
  ipcMain.handle('gittree:open', async (_e, repoPath: string, saved?: string) => {
    const exe = findGitTree(saved)
    if (!exe) return { ok: false, notFound: true, downloadUrl: GITTREE_DOWNLOAD_URL }
    return { ...(await launchGitTree(exe, repoPath)), path: exe }
  })

  ipcMain.on('clipboard:write', (_e, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())

  ipcMain.handle('fs:removeDir', async (_e, dirPath: string) => {
    await rm(dirPath, { recursive: true, force: true })
  })

  ipcMain.handle('fs:searchFiles', async (_e, rootPath: string, query: string, maxResults = 300, exts?: string[]) => {
    if (!query || query.length < 2) return []
    const lowerQuery = query.toLowerCase()
    const skipDirs = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'out', '.vs', 'packages', '.worktrees'])
    const extSet = exts?.length ? new Set(exts.map(e => e.toLowerCase())) : null
    const results: { file: string; line: number; column: number; preview: string; next: string }[] = []
    const files: string[] = []

    // parallel directory walk (collects file paths first)
    const WALK_CONCURRENCY = 32
    let walkRunning = 0
    const walkQueue: string[] = [rootPath]
    const walkWaiters: Array<() => void> = []
    const walkAcquire = async () => {
      if (walkRunning >= WALK_CONCURRENCY) await new Promise<void>(r => walkWaiters.push(r))
      walkRunning++
    }
    const walkRelease = () => { walkRunning--; walkWaiters.shift()?.() }

    async function walk() {
      const dir = walkQueue.shift()
      if (!dir) return
      await walkAcquire()
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (e.name.startsWith('.') || skipDirs.has(e.name)) continue
          const full = join(dir, e.name)
          if (e.isDirectory()) walkQueue.push(full)
          else if (e.isFile() && (!extSet || extSet.has(extname(e.name).toLowerCase()))) files.push(full)
        }
      } catch { /* unreadable */ } finally {
        walkRelease()
        if (walkQueue.length > 0) await walk()
      }
    }
    await Promise.all(Array.from({ length: Math.min(WALK_CONCURRENCY, 8) }, () => walk()))

    // parallel file scan (limited concurrency), stops early at maxResults
    let nextFile = 0
    async function worker(): Promise<void> {
      while (results.length < maxResults) {
        const i = nextFile++
        if (i >= files.length) break
        try {
          const s = await stat(files[i])
          if (s.size > 1024 * 1024) continue
          const content = await readFile(files[i], 'utf-8')
          if (content.includes('\0')) continue
          const lines = content.split('\n')
          for (let ln = 0; ln < lines.length && results.length < maxResults; ln++) {
            const idx = lines[ln].toLowerCase().indexOf(lowerQuery)
            if (idx >= 0) {
              results.push({
                file: files[i],
                line: ln + 1,
                column: idx + 1,
                preview: lines[ln].slice(0, 200).trim(),
                // symbol scoring needs the next line to recognise Allman-style bodies
                next: (lines[ln + 1] ?? '').slice(0, 200).trim()
              })
            }
          }
        } catch { /* binary or unreadable */ }
      }
    }
    await Promise.all(Array.from({ length: 16 }, () => worker()))
    return results
  })

  ipcMain.handle('fs:listFiles', async (_e, rootPath: string, maxResults = 100000) => {
    const results: string[] = []
    const skipDirs = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'out', '.vs', 'packages', '.worktrees'])
    const CONCURRENCY = 64
    let running = 0
    const waiters: Array<() => void> = []

    const acquire = async () => {
      if (running >= CONCURRENCY) await new Promise<void>(r => waiters.push(r))
      running++
    }
    const release = () => { running--; waiters.shift()?.() }

    async function walk(dir: string): Promise<void> {
      if (results.length >= maxResults) return
      await acquire()
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        release()
        return
      }
      release()
      const sub: Promise<void>[] = []
      for (const e of entries) {
        if (e.name.startsWith('.') || skipDirs.has(e.name)) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) sub.push(walk(full))
        else if (e.isFile()) results.push(full)
      }
      await Promise.all(sub)
    }

    await walk(rootPath)
    return results
  })

  // ─── Filesystem watch (auto-refresh of changes / file tree) ─────────────────
  // roots watched per window: closing a window (detached ones go away with their trees still
  // mounted) releases what it still holds
  const watchedBy = new Map<number, string[]>()
  ipcMain.handle('fs:watch', (e, root: string) => {
    watchRoot(root)
    const id = e.sender.id
    if (!watchedBy.has(id)) {
      watchedBy.set(id, [])
      e.sender.once('destroyed', () => {
        for (const r of watchedBy.get(id) ?? []) unwatchRoot(r)
        watchedBy.delete(id)
      })
    }
    watchedBy.get(id)!.push(root)
  })
  ipcMain.handle('fs:unwatch', (e, root: string) => {
    const roots = watchedBy.get(e.sender.id)
    const i = roots ? roots.indexOf(root) : -1
    if (i >= 0) roots!.splice(i, 1)
    unwatchRoot(root)
  })

  // ─── Open with DamnedIDE: the path passed at launch (folder / .md) ──────────
  ipcMain.handle('app:initialTarget', () => {
    const target = pendingOpenTarget
    pendingOpenTarget = null
    return target
  })

  // ─── Git: show file ─────────────────────────────────
  ipcMain.handle('git:showFile', (_e, repoPath: string, filePath: string) =>
    git.showFile(repoPath, filePath))
  ipcMain.handle('git:showRef', (_e, repoPath: string, filePath: string, ref: string) =>
    git.showRef(repoPath, filePath, ref))
  ipcMain.handle('git:stageAll', (_e, repoPath: string) => git.stageAll(repoPath))
  ipcMain.handle('git:transferChanges', (_e, sourcePath: string, targetPath: string, opts: { copy: boolean; stagedOnly: boolean }) =>
    git.transferChanges(sourcePath, targetPath, opts))
  ipcMain.handle('git:pushWithUpstream', (_e, repoPath: string) => git.pushWithUpstream(repoPath))
  ipcMain.handle('git:pushBranch', (_e, repoPath: string, branch: string) => git.pushBranch(repoPath, branch))
  ipcMain.handle('git:merge', (_e, repoPath: string, branch: string) => git.merge(repoPath, branch))
  ipcMain.handle('git:currentBranch', (_e, repoPath: string) => git.currentBranch(repoPath))
  ipcMain.handle('git:gitCommonDir', (_e, repoPath: string) => git.gitCommonDir(repoPath))
  ipcMain.handle('git:resolveRepoRoot', (_e, dirPath: string) => git.resolveRepoRoot(dirPath))
  ipcMain.handle('git:blame', (_e, repoPath: string, filePath: string) => git.blame(repoPath, filePath))
  ipcMain.handle('git:fileLog', (_e, repoPath: string, filePath: string, count?: number) => git.fileLog(repoPath, filePath, count))
  ipcMain.handle('git:diffFile', (_e, repoPath: string, filePath: string) => git.diffFile(repoPath, filePath))

  // ─── Terminal ────────────────────────────────────────
  ipcMain.handle('terminal:create', (_e, cwd: string, type: TerminalType) => {
    // route output to the window that created the terminal (main or detached)
    const target = BrowserWindow.fromWebContents(_e.sender) ?? mainWindow
    return createTerminal(cwd, type, target)
  })
  ipcMain.handle('terminal:write', (_e, id: string, data: string) => {
    writeToTerminal(id, data)
  })
  ipcMain.handle('terminal:resize', (_e, id: string, cols: number, rows: number) => {
    resizeTerminal(id, cols, rows)
  })
  ipcMain.handle('terminal:destroy', (_e, id: string) => {
    destroyTerminal(id)
  })

  // ─── Long-running process ──────────────────────────
  ipcMain.handle('process:start', (e, cwd: string, command: string, args: string[]) => {
    // output and exit go back to the window that started it (a detached Editor too)
    return startProcess(cwd, command, args, senderWindow(e))
  })
  ipcMain.handle('process:stop', (_e, id: string) => {
    stopProcess(id)
  })

  ipcMain.handle('shell:exec', async (_e, command: string, cwd: string): Promise<string> => {
    return new Promise((resolve) => {
      const proc = exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        const out = stdout + (stderr || '') + (error ? `\r\n${error.message}` : '')
        resolve(out)
      })
      setTimeout(() => {
        if (proc.exitCode === null) {
          proc.kill()
          resolve('\r\n[timeout]\r\n')
        }
      }, 60000)
    })
  })

  // ─── Window controls (operate on the window that sent the request, so detached
  //      windows control themselves instead of closing the main one) ────────────
  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window:maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w?.isMaximized()) {
      w.unmaximize()
    } else {
      w?.maximize()
    }
  })
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())

  // ─── Detach panel ───────────────────────────────────
  ipcMain.handle('window:openDetached', (_e, panelId: string, context?: { repoPath?: string | null; worktree?: string | null }) => {
    if (!/^\w+$/.test(panelId)) return false
    // the repository (and worktree) of the window it came from, read by App.tsx
    const params = new URLSearchParams()
    if (context?.repoPath) params.set('repo', context.repoPath)
    if (context?.repoPath && context.worktree) params.set('wt', context.worktree)
    const query = params.toString()
    const hash = `#/panel/${panelId}${query ? `?${query}` : ''}`
    const detached = new BrowserWindow({
      width: 900,
      height: 650,
      minWidth: 500,
      minHeight: 350,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#000000',
      icon: appIcon(),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    const url = process.env.ELECTRON_RENDERER_URL
      ? `${process.env.ELECTRON_RENDERER_URL}${hash}`
      : `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}${hash}`

    detached.loadURL(url)

    detached.on('ready-to-show', () => detached.show())
    // links (target=_blank, window.open) open in the browser, as in the main window
    detached.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })
    return true
  })

  // ─── Roslyn (C# semantic navigation) ────────────────
  ipcMain.handle('roslyn:ensure', (_e, rootPath: string) => roslyn.ensure(rootPath))
  ipcMain.handle('roslyn:definition', (_e, file: string, line: number, column: number) => roslyn.definition(file, line, column))
  ipcMain.handle('roslyn:implementation', (_e, file: string, line: number, column: number) => roslyn.implementation(file, line, column))
  ipcMain.handle('roslyn:references', (_e, file: string, line: number, column: number) => roslyn.references(file, line, column))
  ipcMain.handle('roslyn:diagnostics', (_e, file: string, text?: string) => roslyn.diagnostics(file, text))
  ipcMain.handle('roslyn:hover', (_e, file: string, line: number, column: number, text?: string) => roslyn.hover(file, line, column, text))

  // ─── MCP ─────────
  ipcMain.handle('mcp:connect', (_e, config: McpServerConfig) => mcp.connect(config, mainWindow))
  ipcMain.handle('mcp:disconnect', (_e, name: string) => { mcp.disconnect(name) })
  ipcMain.handle('mcp:listTools', (_e, name: string) => mcp.listTools(name))
  ipcMain.handle('mcp:callTool', (_e, name: string, tool: string, args: Record<string, unknown>) => mcp.callTool(name, tool, args, mainWindow))

  // ─── Claude (subscription CLI / Anthropic API) ─────
  ipcMain.handle('ai:status', () => claude.status())
  ipcMain.handle('ai:setApiKey', ipc((key: string | null) => { setApiKey(key); return hasApiKey() }))
  ipcMain.handle('ai:hasApiKey', () => hasApiKey())

  // ─── Agent chat (multi-provider: claude / opencode / codex / cursor) ───
  // `ai:test` keeps accepting the legacy (backend) signature used by Claude.
  ipcMain.handle('ai:test', (_e, provider?: AgentProviderId | 'subscription' | 'api', backend?: 'subscription' | 'api', model?: string) => {
    if (provider === 'subscription' || provider === 'api') return claude.test(provider, mainWindow)
    return agent.test((provider as AgentProviderId) || 'claude', mainWindow, backend, model)
  })
  ipcMain.handle('ai:providers', (_e, refresh?: boolean) => agent.providers({ refresh: !!refresh }))
  ipcMain.handle('ai:models', (_e, provider: AgentProviderId) => agent.listModels(provider))
  ipcMain.handle('ai:send', (_e, req: AgentSendRequest) => agent.send(req, mainWindow))
  ipcMain.handle('ai:cancel', (_e, chatKey: string) => { agent.cancel(chatKey) })
}

// ─── DamnedCloud remote bridge ───────────────────────────────────────────────
function registerRemoteIpc(remote: RemoteService): void {
  ipcMain.handle('remote:status', () => remote.status())
  ipcMain.handle('remote:start', (_e, options: { port?: number; host?: string; tls?: { certPath: string; keyPath: string } }) => remote.start(options))
  ipcMain.handle('remote:stop', async () => {
    await remote.stop()
    return remote.status()
  })
  ipcMain.handle('remote:pairing:begin', () => remote.beginPairing())
  ipcMain.handle('remote:pairing:pending', () => remote.listPending())
  ipcMain.handle('remote:pairing:resolve', (_e, id: string, accepted: boolean) => { remote.resolvePairing(id, accepted) })

  ipcMain.handle('remote:devices', () => remote.listDevices())
  ipcMain.handle('remote:device:revoke', (_e, id: string) => { remote.revokeDevice(id); return remote.listDevices() })
  ipcMain.handle('remote:device:scopes', (_e, id: string, scopes: RemoteScope[]) => {
    remote.updateScopes(id, scopes)
    return remote.listDevices()
  })
  ipcMain.handle('remote:devices:revokeAll', () => { remote.revokeAll(); return remote.listDevices() })

  ipcMain.handle('remote:workspace:set', (_e, patch: Partial<Omit<WorkspaceSnapshot, 'revision'>>) => remote.setWorkspace(patch))
  ipcMain.handle('remote:sql:connections', (_e, connections: RemoteSqlConnection[]) => { remote.setSqlConnections(connections) })
  ipcMain.handle('remote:broadcast', (_e, topic: 'git.changed' | 'sql.execution', data: unknown) => remote.broadcast(topic, data))
  ipcMain.handle('remote:apply:ack', () => { /* reserved */ })
}
