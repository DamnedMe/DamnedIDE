import { app, BrowserWindow, shell, ipcMain, dialog, clipboard, nativeImage } from 'electron'
import { join, normalize } from 'path'
import { readdir, readFile, writeFile, stat, rm, mkdir } from 'fs/promises'
import { exec } from 'child_process'
import { GitService } from './services/git/git.service'
import { WorktreeService } from './services/git/worktree.service'
import { DiffService } from './services/git/diff.service'
import { AdoService } from './services/ado/ado.service'
import { SqlService, SqlConnectionConfig } from './services/sql/sql.service'
import { RoslynService } from './services/roslyn/roslyn.service'
import { createTerminal, writeToTerminal, resizeTerminal, destroyTerminal, destroyAllTerminals, TerminalType } from './services/terminal/terminal.service'
import { startProcess, stopProcess, stopAllProcesses } from './services/process/process.service'

let mainWindow: BrowserWindow | null = null
let roslynService: RoslynService | null = null

function appIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.ico'))
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
  const worktreeService = new WorktreeService()
  const diffService = new DiffService()
  const adoService = new AdoService()
  const sqlService = new SqlService()
  roslynService = new RoslynService()

  registerIpcHandlers(gitService, worktreeService, diffService, adoService, sqlService, roslynService)
  createWindow()

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
  roslynService?.stop()
})

function registerIpcHandlers(
  git: GitService,
  worktree: WorktreeService,
  diff: DiffService,
  ado: AdoService,
  sql: SqlService,
  roslyn: RoslynService
): void {
  // ─── Git ───────────────────────────────────────────
  ipcMain.handle('git:status', (_e, repoPath: string) => git.status(repoPath))
  ipcMain.handle('git:porcelain', (_e, repoPath: string) => git.porcelain(repoPath))
  ipcMain.handle('git:stage', (_e, repoPath: string, files: string[]) => git.stage(repoPath, files))
  ipcMain.handle('git:unstage', (_e, repoPath: string, files: string[]) => git.unstage(repoPath, files))
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
  ipcMain.handle('worktree:remove', (_e, repoPath: string, worktreePath: string) => worktree.remove(repoPath, worktreePath))
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
  ipcMain.handle('sql:connect', (_e, config: SqlConnectionConfig) => sql.connect(config))
  ipcMain.handle('sql:disconnect', (_e, connectionId: string) => sql.disconnect(connectionId))
  ipcMain.handle('sql:query', (_e, connectionId: string, query: string) => sql.executeQuery(connectionId, query))
  ipcMain.handle('sql:databases', (_e, connectionId: string) => sql.listDatabases(connectionId))
  ipcMain.handle('sql:tables', (_e, connectionId: string, database: string) => sql.listTables(connectionId, database))

  // ─── Dialog ────────────────────────────────────────
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
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

  ipcMain.on('clipboard:write', (_e, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('fs:removeDir', async (_e, dirPath: string) => {
    await rm(dirPath, { recursive: true, force: true })
  })

  ipcMain.handle('fs:searchFiles', async (_e, rootPath: string, query: string, maxResults = 300) => {
    if (!query || query.length < 2) return []
    const results: { file: string; line: number; column: number; preview: string }[] = []
    const lowerQuery = query.toLowerCase()
    const skipDirs = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'out', '.vs', 'packages', '.worktrees'])

    async function walk(dir: string): Promise<void> {
      if (results.length >= maxResults) return
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (results.length >= maxResults) return
        if (e.name.startsWith('.') || skipDirs.has(e.name)) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) {
          await walk(full)
        } else if (e.isFile()) {
          try {
            const s = await stat(full)
            if (s.size > 1024 * 1024) continue
            const content = await readFile(full, 'utf-8')
            if (content.includes('\0')) continue
            const lines = content.split('\n')
            for (let i = 0; i < lines.length && results.length < maxResults; i++) {
              const idx = lines[i].toLowerCase().indexOf(lowerQuery)
              if (idx >= 0) {
                results.push({
                  file: full,
                  line: i + 1,
                  column: idx + 1,
                  preview: lines[i].trim().substring(0, 200)
                })
              }
            }
          } catch { /* binary or unreadable */ }
        }
      }
    }

    await walk(rootPath)
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

  // ─── Git: show file ─────────────────────────────────
  ipcMain.handle('git:showFile', (_e, repoPath: string, filePath: string) =>
    git.showFile(repoPath, filePath))
  ipcMain.handle('git:showRef', (_e, repoPath: string, filePath: string, ref: string) =>
    git.showRef(repoPath, filePath, ref))
  ipcMain.handle('git:stageAll', (_e, repoPath: string) => git.stageAll(repoPath))
  ipcMain.handle('git:pushWithUpstream', (_e, repoPath: string) => git.pushWithUpstream(repoPath))
  ipcMain.handle('git:merge', (_e, repoPath: string, branch: string) => git.merge(repoPath, branch))
  ipcMain.handle('git:currentBranch', (_e, repoPath: string) => git.currentBranch(repoPath))
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
}
