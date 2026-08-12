import { contextBridge, ipcRenderer } from 'electron'
import type { SqlConnectionConfig } from './services/sql/sql.service'
import type { TerminalType } from './services/terminal/terminal.service'

const electronAPI = {
  git: {
    status: (repoPath: string) => ipcRenderer.invoke('git:status', repoPath),
    porcelain: (repoPath: string) => ipcRenderer.invoke('git:porcelain', repoPath),
    stage: (repoPath: string, files: string[]) => ipcRenderer.invoke('git:stage', repoPath, files),
    unstage: (repoPath: string, files: string[]) => ipcRenderer.invoke('git:unstage', repoPath, files),
    commit: (repoPath: string, message: string) => ipcRenderer.invoke('git:commit', repoPath, message),
    branches: (repoPath: string) => ipcRenderer.invoke('git:branches', repoPath),
    log: (repoPath: string, count: number) => ipcRenderer.invoke('git:log', repoPath, count),
    pull: (repoPath: string) => ipcRenderer.invoke('git:pull', repoPath),
    push: (repoPath: string) => ipcRenderer.invoke('git:push', repoPath),
    fetch: (repoPath: string) => ipcRenderer.invoke('git:fetch', repoPath),
    showFile: (repoPath: string, filePath: string) => ipcRenderer.invoke('git:showFile', repoPath, filePath),
    showRef: (repoPath: string, filePath: string, ref: string) => ipcRenderer.invoke('git:showRef', repoPath, filePath, ref),
    stageAll: (repoPath: string) => ipcRenderer.invoke('git:stageAll', repoPath),
    pushWithUpstream: (repoPath: string) => ipcRenderer.invoke('git:pushWithUpstream', repoPath),
    merge: (repoPath: string, branch: string) => ipcRenderer.invoke('git:merge', repoPath, branch),
    currentBranch: (repoPath: string) => ipcRenderer.invoke('git:currentBranch', repoPath),
    blame: (repoPath: string, filePath: string) => ipcRenderer.invoke('git:blame', repoPath, filePath),
    fileLog: (repoPath: string, filePath: string, count?: number) => ipcRenderer.invoke('git:fileLog', repoPath, filePath, count),
    diffFile: (repoPath: string, filePath: string) => ipcRenderer.invoke('git:diffFile', repoPath, filePath)
  },
  worktree: {
    list: (repoPath: string) => ipcRenderer.invoke('worktree:list', repoPath),
    add: (repoPath: string, branch: string, path: string) =>
      ipcRenderer.invoke('worktree:add', repoPath, branch, path),
    remove: (repoPath: string, worktreePath: string) => ipcRenderer.invoke('worktree:remove', repoPath, worktreePath),
    prune: (repoPath: string) => ipcRenderer.invoke('worktree:prune', repoPath)
  },
  diff: {
    unstaged: (repoPath: string, file: string) => ipcRenderer.invoke('diff:unstaged', repoPath, file),
    staged: (repoPath: string, file: string) => ipcRenderer.invoke('diff:staged', repoPath, file),
    branch: (repoPath: string, branchA: string, branchB: string) =>
      ipcRenderer.invoke('diff:branch', repoPath, branchA, branchB)
  },
  ado: {
    connect: (org: string, token: string) => ipcRenderer.invoke('ado:connect', org, token),
    workItems: (project: string) => ipcRenderer.invoke('ado:workItems', project),
    workItem: (project: string, id: number) => ipcRenderer.invoke('ado:workItem', project, id),
    pullRequests: (project: string, repo: string) => ipcRenderer.invoke('ado:pullRequests', project, repo),
    pullRequestDetail: (project: string, repo: string, prId: number) => ipcRenderer.invoke('ado:pullRequestDetail', project, repo, prId),
    pullRequestFiles: (project: string, repo: string, prId: number) => ipcRenderer.invoke('ado:pullRequestFiles', project, repo, prId),
    fileContent: (project: string, repo: string, path: string, commitId: string) => ipcRenderer.invoke('ado:fileContent', project, repo, path, commitId),
    pullRequestThreads: (project: string, repo: string, prId: number) => ipcRenderer.invoke('ado:pullRequestThreads', project, repo, prId),
    branches: (project: string, repo: string) => ipcRenderer.invoke('ado:branches', project, repo),
    repositories: (project: string) => ipcRenderer.invoke('ado:repositories', project),
    commitsBetween: (project: string, repo: string, source: string, target: string) => ipcRenderer.invoke('ado:commitsBetween', project, repo, source, target),
    setVote: (project: string, repo: string, prId: number, vote: number) => ipcRenderer.invoke('ado:setVote', project, repo, prId, vote),
    completePr: (project: string, repo: string, prId: number, sourceCommitId: string) => ipcRenderer.invoke('ado:completePr', project, repo, prId, sourceCommitId),
    createPr: (project: string, repo: string, opts: { sourceRef: string; targetRef: string; title: string; description: string; autoComplete: boolean; workItemIds?: number[] }) => ipcRenderer.invoke('ado:createPr', project, repo, opts)
  },
  sql: {
    connect: (config: SqlConnectionConfig) => ipcRenderer.invoke('sql:connect', config),
    disconnect: (connectionId: string) => ipcRenderer.invoke('sql:disconnect', connectionId),
    query: (connectionId: string, query: string, queryId?: string, maxRows?: number, database?: string) =>
      ipcRenderer.invoke('sql:query', connectionId, query, queryId, maxRows, database),
    cancelQuery: (queryId: string) => ipcRenderer.invoke('sql:cancelQuery', queryId),
    testConnection: (config: SqlConnectionConfig) => ipcRenderer.invoke('sql:testConnection', config),
    serverInfo: (connectionId: string) => ipcRenderer.invoke('sql:serverInfo', connectionId),
    databases: (connectionId: string) => ipcRenderer.invoke('sql:databases', connectionId),
    tables: (connectionId: string, database: string) => ipcRenderer.invoke('sql:tables', connectionId, database),
    views: (connectionId: string, database: string) => ipcRenderer.invoke('sql:views', connectionId, database),
    procedures: (connectionId: string, database: string) => ipcRenderer.invoke('sql:procedures', connectionId, database),
    functions: (connectionId: string, database: string) => ipcRenderer.invoke('sql:functions', connectionId, database),
    columns: (connectionId: string, database: string, table: string) =>
      ipcRenderer.invoke('sql:columns', connectionId, database, table),
    objectDefinition: (connectionId: string, database: string, objectName: string) =>
      ipcRenderer.invoke('sql:objectDefinition', connectionId, database, objectName),
    diagram: (connectionId: string, database: string, tables?: string[]) =>
      ipcRenderer.invoke('sql:diagram', connectionId, database, tables),
    buildConnectionString: (config: SqlConnectionConfig) => ipcRenderer.invoke('sql:buildConnectionString', config),
    parseConnectionString: (cs: string) => ipcRenderer.invoke('sql:parseConnectionString', cs)
  },
  roslyn: {
    ensure: (rootPath: string) => ipcRenderer.invoke('roslyn:ensure', rootPath),
    definition: (file: string, line: number, column: number) => ipcRenderer.invoke('roslyn:definition', file, line, column),
    implementation: (file: string, line: number, column: number) => ipcRenderer.invoke('roslyn:implementation', file, line, column),
    references: (file: string, line: number, column: number) => ipcRenderer.invoke('roslyn:references', file, line, column),
    diagnostics: (file: string, text?: string) => ipcRenderer.invoke('roslyn:diagnostics', file, text),
    hover: (file: string, line: number, column: number, text?: string) => ipcRenderer.invoke('roslyn:hover', file, line, column, text)
  },
  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:openFolder')
  },
  fs: {
    readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    removeDir: (dirPath: string) => ipcRenderer.invoke('fs:removeDir', dirPath),
    delete: (targetPath: string) => ipcRenderer.invoke('fs:delete', targetPath),
    mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),
    searchFiles: (rootPath: string, query: string, maxResults?: number) =>
      ipcRenderer.invoke('fs:searchFiles', rootPath, query, maxResults),
    listFiles: (rootPath: string, maxResults?: number) =>
      ipcRenderer.invoke('fs:listFiles', rootPath, maxResults)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    openDetached: (panelId: string) => ipcRenderer.invoke('window:openDetached', panelId)
  },
  updater: {
    install: () => ipcRenderer.invoke('update:install'),
    onDownloaded: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('update:downloaded', handler)
      return () => ipcRenderer.removeListener('update:downloaded', handler)
    }
  },
  terminal: {
    create: (cwd: string, type: TerminalType) => ipcRenderer.invoke('terminal:create', cwd, type),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    destroy: (id: string) => ipcRenderer.invoke('terminal:destroy', id),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, data: string) => callback(id, data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    }
  },
  shell: {
    exec: (command: string, cwd: string) => ipcRenderer.invoke('shell:exec', command, cwd),
    openFolder: (path: string) => ipcRenderer.invoke('shell:openFolder', path)
  },
  clipboard: {
    write: (text: string) => ipcRenderer.send('clipboard:write', text)
  },
  process: {
    start: (cwd: string, command: string, args: string[]) => ipcRenderer.invoke('process:start', cwd, command, args),
    stop: (id: string) => ipcRenderer.invoke('process:stop', id),
    onOutput: (callback: (id: string, data: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, data: string) => callback(id, data)
      ipcRenderer.on('process:output', handler)
      return () => ipcRenderer.removeListener('process:output', handler)
    },
    onExit: (callback: (id: string, code: number | null) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, code: number | null) => callback(id, code)
      ipcRenderer.on('process:exit', handler)
      return () => ipcRenderer.removeListener('process:exit', handler)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
