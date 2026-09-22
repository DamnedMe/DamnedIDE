import { app, BrowserWindow, shell, ipcMain, dialog, clipboard, nativeImage } from 'electron'
import { join, normalize, extname } from 'path'
import { readdir, readFile, writeFile, stat, rm, mkdir } from 'fs/promises'
import { exec } from 'child_process'
import { GitService } from './services/git/git.service'
import { WorktreeService } from './services/git/worktree.service'
import { DiffService } from './services/git/diff.service'
import { AdoService } from './services/ado/ado.service'
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

let mainWindow: BrowserWindow | null = null
let roslynService: RoslynService | null = null
let mcpService: McpService | null = null
let claudeService: ClaudeService | null = null
let agentService: AgentService | null = null

// IPC wrapper: rejects with a clean one-line Error (no mssql stack trace) so the
// dev console does not flood with "Error occurred in handler for 'sql:...'".
function ipc<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult
): (_e: Electron.IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> {
  return async (_e, ...args) => {
    try {
      return await fn(...args)
    } catch (err) {
      const msg = (err as Error)?.message || String(err)
      console.error(`[sql] ${msg}`)
      const clean = new Error(msg)
      ;(clean as Error & { stack?: string | undefined }).stack = undefined
      throw clean
    }
  }
}

function appIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.ico'))
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

// A second launch (e.g. "Open with" on another file) must reach the running
// instance instead of starting a new one.
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', (_e, argv) => {
    const target = argvOpenTarget(argv)
    if (target) sendOpenTarget(target)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
} else {
  app.quit()
}

// macOS: Finder "Open with" delivers the file through this event, not argv, and
// it can fire before the app is ready
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  const target = resolveOpenTarget(filePath)
  if (target) sendOpenTarget(target)
})

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
  const worktreeService = new WorktreeService()
  const diffService = new DiffService()
  const adoService = new AdoService()
  const sqlService = new SqlService()
  const sqlWorkspaceService = new SqlWorkspaceService(app.getPath('userData'))
  mcpService = new McpService()
  claudeService = new ClaudeService()
  agentService = new AgentService(claudeService)
  roslynService = new RoslynService()

  registerIpcHandlers(gitService, worktreeService, diffService, adoService, sqlService, sqlWorkspaceService, roslynService, mcpService, claudeService, agentService)
  const fromArgv = argvOpenTarget(process.argv)
  if (fromArgv) pendingOpenTarget = fromArgv
  createWindow()
  // OTA: automatic checks + the manual "verifica aggiornamenti" in settings
  new UpdateService(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  destroyAllTerminals()
  stopAllProcesses()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  // Any quit path (window-all-closed, update restart, app.quit) must tear down
  // running processes and terminals, otherwise spawned apps keep their ports.
  stopAllProcesses()
  destroyAllTerminals()
  roslynService?.stop()
  mcpService?.disconnectAll()
  agentService?.cancelAll()
  closeAllWatchers()
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
  ipcMain.handle('git:fetch', (_e, repoPath: string) => git.fetch(repoPath))

  // ─── Worktree ──────────────────────────────────────
  ipcMain.handle('worktree:list', (_e, repoPath: string) => worktree.list(repoPath))
  ipcMain.handle('worktree:add', (_e, repoPath: string, branch: string, path: string) =>
    worktree.add(repoPath, branch, path))
  ipcMain.handle('worktree:remove', (_e, repoPath: string, worktreePath: string, force?: boolean) => {
    // a terminal rooted in the worktree keeps a handle on the folder on Windows:
    // on a forced removal close those first, otherwise rm/`worktree remove` fail
    if (force) destroyTerminalsUnderPath(worktreePath)
    return worktree.remove(repoPath, worktreePath, !!force)
  })
  ipcMain.handle('worktree:prune', (_e, repoPath: string) => worktree.prune(repoPath))

  // ─── Diff ──────────────────────────────────────────
  ipcMain.handle('diff:unstaged', (_e, repoPath: string, file: string) => diff.unstaged(repoPath, file))
  ipcMain.handle('diff:staged', (_e, repoPath: string, file: string) => diff.staged(repoPath, file))
  ipcMain.handle('diff:branch', (_e, repoPath: string, branchA: string, branchB: string) =>
    diff.branchDiff(repoPath, branchA, branchB))

  // ─── Azure DevOps ──────────────────────────────────
  ipcMain.handle('ado:connect', (_e, org: string, token: string) => ado.connect(org, token))
  ipcMain.handle('ado:workItems', (_e, project: string) => ado.getWorkItems(project))
  ipcMain.handle('ado:workItem', (_e, project: string, id: number) => ado.getWorkItem(project, id))
  ipcMain.handle('ado:pullRequests', (_e, project: string, repo: string) => ado.getPullRequests(project, repo))
  ipcMain.handle('ado:pullRequestDetail', (_e, project: string, repo: string, prId: number) => ado.getPullRequestDetail(project, repo, prId))
  ipcMain.handle('ado:pullRequestFiles', (_e, project: string, repo: string, prId: number) => ado.getPullRequestFiles(project, repo, prId))
  ipcMain.handle('ado:fileContent', (_e, project: string, repo: string, path: string, commitId: string) => ado.getFileContent(project, repo, path, commitId))
  ipcMain.handle('ado:pullRequestThreads', (_e, project: string, repo: string, prId: number) => ado.getPullRequestThreads(project, repo, prId))
  ipcMain.handle('ado:branches', (_e, project: string, repo: string) => ado.getBranches(project, repo))
  ipcMain.handle('ado:repositories', (_e, project: string) => ado.getRepositories(project))
  ipcMain.handle('ado:commitsBetween', (_e, project: string, repo: string, source: string, target: string) => ado.getCommitsBetween(project, repo, source, target))
  ipcMain.handle('ado:setVote', (_e, project: string, repo: string, prId: number, vote: number) => ado.setVote(project, repo, prId, vote))
  ipcMain.handle('ado:completePr', (_e, project: string, repo: string, prId: number, sourceCommitId: string) => ado.completePr(project, repo, prId, sourceCommitId))
  ipcMain.handle('ado:createPr', (_e, project: string, repo: string, opts: { sourceRef: string; targetRef: string; title: string; description: string; autoComplete: boolean }) => ado.createPullRequest(project, repo, opts))

  // ─── SQL Server ────────────────────────────────────
  ipcMain.handle('sql:connect', ipc((config: SqlConnectionConfig) => sql.connect(config)))
  ipcMain.handle('sql:disconnect', ipc((connectionId: string) => sql.disconnect(connectionId)))
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

  // ─── Dialog ────────────────────────────────────────
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:saveSqlQuery', async (_e, defaultName: string, content: string) => {
    const safeName = (defaultName || 'query.sql').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '') || 'query.sql'
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save SQL query',
      defaultPath: safeName.toLocaleLowerCase().endsWith('.sql') ? safeName : `${safeName}.sql`,
      filters: [{ name: 'SQL query', extensions: ['sql'] }, { name: 'All files', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, content, 'utf-8')
    return result.filePath
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

  ipcMain.on('clipboard:write', (_e, text: string) => {
    clipboard.writeText(text)
  })

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
  ipcMain.handle('fs:watch', (_e, root: string) => { watchRoot(root) })
  ipcMain.handle('fs:unwatch', (_e, root: string) => { unwatchRoot(root) })

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
  ipcMain.handle('git:merge', (_e, repoPath: string, branch: string) => git.merge(repoPath, branch))
  ipcMain.handle('git:currentBranch', (_e, repoPath: string) => git.currentBranch(repoPath))
  ipcMain.handle('git:gitCommonDir', (_e, repoPath: string) => git.gitCommonDir(repoPath))
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
  ipcMain.handle('process:start', (_e, cwd: string, command: string, args: string[]) => {
    return startProcess(cwd, command, args, mainWindow)
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
  ipcMain.handle('window:openDetached', (_e, panelId: string) => {
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
      ? `${process.env.ELECTRON_RENDERER_URL}#/panel/${panelId}`
      : `file://${join(__dirname, '../renderer/index.html')}#/panel/${panelId}`

    detached.loadURL(url)

    detached.on('ready-to-show', () => detached.show())
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
  ipcMain.handle('ai:test', (_e, backend: 'subscription' | 'api') => claude.test(backend, mainWindow))
  ipcMain.handle('ai:setApiKey', ipc((key: string | null) => { setApiKey(key); return hasApiKey() }))
  ipcMain.handle('ai:hasApiKey', () => hasApiKey())

  // ─── Agent chat (multi-provider: claude / opencode / codex / cursor) ───
  ipcMain.handle('ai:providers', () => agent.providers())
  ipcMain.handle('ai:models', (_e, provider: AgentProviderId) => agent.listModels(provider))
  ipcMain.handle('ai:send', (_e, req: AgentSendRequest) => agent.send(req, mainWindow))
  ipcMain.handle('ai:cancel', (_e, chatKey: string) => { agent.cancel(chatKey) })
}
