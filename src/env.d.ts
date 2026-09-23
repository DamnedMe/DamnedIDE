/// <reference types="vite/client" />

interface McpTool {
  name: string
  description: string
  inputSchema?: unknown
}

type ClaudeBackend = 'subscription' | 'api'
type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

interface ClaudeUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

interface ClaudeSendRequest {
  chatKey: string
  prompt: string
  backend: ClaudeBackend
  model: string
  effort: ClaudeEffort
  system?: string
  cwd?: string
  permissionMode?: string
  resume?: string
  history?: { role: 'user' | 'assistant'; text: string }[]
}

type AgentProviderId = 'claude' | 'opencode' | 'codex' | 'cursor'

interface AgentSendRequest {
  chatKey: string
  provider: AgentProviderId
  prompt: string
  cwd?: string
  system?: string
  model?: string
  effort?: string
  permissionMode?: string
  resume?: string
  history?: { role: 'user' | 'assistant'; text: string }[]
  backend?: ClaudeBackend
}

interface AgentProviderInfo {
  id: AgentProviderId
  label: string
  available: boolean
  detail: string
  models: { id: string; label: string }[]
  efforts: string[]
  permissionModes: string[]
  loggedIn?: boolean
  loginCommand?: string
  supportsApiKey?: boolean
  installHint?: string
  docsUrl?: string
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'

interface UpdateState {
  packaged: boolean
  currentVersion: string
  status: UpdateStatus
  version?: string
  progress?: number
  error?: string
}

interface ClaudeResult {
  ok: boolean
  text?: string
  error?: string
  sessionId?: string
  costUsd?: number
  usage?: ClaudeUsage
}

interface ClaudeAuthStatus {
  cli: boolean
  loggedIn: boolean
  authMethod?: string
  email?: string
  subscriptionType?: string
  hasApiKey: boolean
}

interface Window {
  electronAPI: {
    // 'win32' | 'darwin' | 'linux'
    platform: string
    ai: {
      status: () => Promise<ClaudeAuthStatus>
      test: (provider?: AgentProviderId | ClaudeBackend, backend?: ClaudeBackend) => Promise<ClaudeResult>
      providers: (refresh?: boolean) => Promise<AgentProviderInfo[]>
      models: (provider: AgentProviderId) => Promise<{ id: string; label: string }[]>
      send: (req: AgentSendRequest) => Promise<ClaudeResult>
      cancel: (chatKey: string) => Promise<void>
      setApiKey: (key: string | null) => Promise<boolean>
      hasApiKey: () => Promise<boolean>
      onChunk: (cb: (p: { chatKey: string; text: string }) => void) => () => void
      onTool: (cb: (p: { chatKey: string; name: string }) => void) => () => void
    }
    mcp: {
      connect: (config: { name: string; command: string; args: string[]; env?: Record<string, string> }) => Promise<{ ok: boolean; error?: string; tools: McpTool[] }>
      disconnect: (name: string) => Promise<void>
      listTools: (name: string) => Promise<McpTool[]>
      callTool: (name: string, tool: string, args: Record<string, unknown>) => Promise<string>
      onTools: (cb: (payload: { name: string; tools: McpTool[] }) => void) => () => void
      onLog: (cb: (payload: { name: string; message: string }) => void) => () => void
    }
    git: {
      status: (repoPath: string) => Promise<import('./types/git').GitStatus>
      porcelain: (repoPath: string) => Promise<{ staged: { path: string; changeType: string }[]; unstaged: { path: string; changeType: string }[]; unmerged: { path: string; changeType: string }[] }>
      stage: (repoPath: string, files: string[]) => Promise<void>
      unstage: (repoPath: string, files: string[]) => Promise<void>
      discardChanges: (repoPath: string, file: string, opts: { staged?: boolean; untracked?: boolean }) => Promise<void>
      commit: (repoPath: string, message: string) => Promise<void>
      branches: (repoPath: string) => Promise<import('./types/git').BranchInfo[]>
      log: (repoPath: string, count: number) => Promise<import('./types/git').CommitInfo[]>
      pull: (repoPath: string) => Promise<void>
      push: (repoPath: string) => Promise<void>
      fetch: (repoPath: string) => Promise<void>
      showFile: (repoPath: string, filePath: string) => Promise<string>
      showRef: (repoPath: string, filePath: string, ref: string) => Promise<string>
      stageAll: (repoPath: string) => Promise<void>
      transferChanges: (sourcePath: string, targetPath: string, opts: { copy: boolean; stagedOnly: boolean }) => Promise<{ ok: boolean; message: string }>
      pushWithUpstream: (repoPath: string) => Promise<void>
      merge: (repoPath: string, branch: string) => Promise<{ ok: boolean; message: string; conflicts: string[] }>
      currentBranch: (repoPath: string) => Promise<string>
      gitCommonDir: (repoPath: string) => Promise<string>
      resolveRepoRoot: (dirPath: string) => Promise<string | null>
      blame: (repoPath: string, filePath: string) => Promise<{ hash: string; author: string; date: string; line: string }[]>
      fileLog: (repoPath: string, filePath: string, count?: number) => Promise<import('./types/git').CommitInfo[]>
      diffFile: (repoPath: string, filePath: string) => Promise<string>
    }
    worktree: {
      list: (repoPath: string) => Promise<WorktreeEntry[]>
      add: (repoPath: string, branch: string, path: string) => Promise<void>
      remove: (repoPath: string, worktreePath: string, force?: boolean) => Promise<{ ok: boolean; warning?: string; trashedPath?: string; error?: string }>
      prune: (repoPath: string) => Promise<void>
    }
    diff: {
      unstaged: (repoPath: string, file: string) => Promise<string>
      staged: (repoPath: string, file: string) => Promise<string>
      branch: (repoPath: string, branchA: string, branchB: string) => Promise<string>
    }
    ado: {
      connect: (org: string, token: string) => Promise<boolean>
      workItems: (project: string) => Promise<import('./types/ado').AdoWorkItem[]>
      workItem: (project: string, id: number) => Promise<import('./types/ado').AdoWorkItem | null>
      pullRequests: (project: string, repo: string) => Promise<import('./types/ado').AdoPullRequest[]>
      pullRequestDetail: (project: string, repo: string, prId: number) => Promise<import('./types/ado').AdoPullRequestDetail | null>
      pullRequestFiles: (project: string, repo: string, prId: number) => Promise<import('./types/ado').AdoPullRequestFile[]>
      fileContent: (project: string, repo: string, path: string, commitId: string) => Promise<string>
      pullRequestThreads: (project: string, repo: string, prId: number) => Promise<import('./types/ado').AdoPullRequestThread[]>
      branches: (project: string, repo: string) => Promise<string[]>
      repositories: (project: string) => Promise<string[]>
      commitsBetween: (project: string, repo: string, source: string, target: string) => Promise<{ commitId: string; message: string; author: string }[]>
      setVote: (project: string, repo: string, prId: number, vote: number) => Promise<boolean>
      completePr: (project: string, repo: string, prId: number, sourceCommitId: string) => Promise<boolean>
      createPr: (project: string, repo: string, opts: { sourceRef: string; targetRef: string; title: string; description: string; autoComplete: boolean; workItemIds?: number[] }) => Promise<{ id: number; title: string; mode: 'autocomplete' | 'completed' | 'open' } | null>
    }
    sql: {
      connect: (config: import('./types/sql').SqlConnectionConfig) => Promise<string>
      disconnect: (connectionId: string) => Promise<void>
      query: (connectionId: string, query: string, queryId?: string, maxRows?: number, database?: string) => Promise<import('./types/sql').SqlExecutionResult>
      cancelQuery: (queryId: string) => Promise<void>
      testConnection: (config: import('./types/sql').SqlConnectionConfig) => Promise<import('./types/sql').SqlTestResult>
      serverInfo: (connectionId: string) => Promise<import('./types/sql').SqlServerInfo>
      databases: (connectionId: string) => Promise<string[]>
      tables: (connectionId: string, database: string) => Promise<string[]>
      views: (connectionId: string, database: string) => Promise<string[]>
      procedures: (connectionId: string, database: string) => Promise<string[]>
      functions: (connectionId: string, database: string) => Promise<string[]>
      columns: (connectionId: string, database: string, table: string) => Promise<import('./types/sql').SqlColumnInfo[]>
      objectDefinition: (connectionId: string, database: string, objectName: string) => Promise<string>
      diagram: (connectionId: string, database: string, tables?: string[]) => Promise<import('./types/sql').SqlDiagramData>
      schemaSnapshot: (connectionId: string, database: string) => Promise<import('./types/sql').SqlSchemaSnapshot>
      workspaceLoad: () => Promise<import('./types/sql').SqlWorkspaceState>
      workspaceSave: (workspace: import('./types/sql').SqlWorkspaceState) => Promise<void>
      buildConnectionString: (config: import('./types/sql').SqlConnectionConfig) => Promise<string>
      parseConnectionString: (cs: string) => Promise<import('./types/sql').SqlConnectionConfig>
    }
    roslyn: {
      ensure: (rootPath: string) => Promise<boolean>
      definition: (file: string, line: number, column: number) => Promise<{ symbol?: string; targets: { file: string; line: number; column: number }[] } | null>
      implementation: (file: string, line: number, column: number) => Promise<{ symbol?: string; targets: { file: string; line: number; column: number }[] } | null>
      references: (file: string, line: number, column: number) => Promise<{ symbol?: string; targets: { file: string; line: number; column: number }[] } | null>
      diagnostics: (file: string, text?: string) => Promise<{ diagnostics: { code?: string; severity: string; message: string; line: number; column: number; endLine: number; endColumn: number }[] } | null>
      hover: (file: string, line: number, column: number, text?: string) => Promise<{ signature: string; type: string; summary: string; kind: string } | null>
    }
    dialog: {
      openFolder: () => Promise<string | null>
      saveSqlQuery: (defaultName: string, content: string) => Promise<string | null>
    }
    fs: {
      readDir: (dirPath: string) => Promise<{ name: string; isDirectory: boolean; isFile: boolean }[]>
      readFile: (filePath: string) => Promise<string>
      writeFile: (filePath: string, content: string) => Promise<void>
      removeDir: (dirPath: string) => Promise<void>
      delete: (targetPath: string) => Promise<void>
      mkdir: (dirPath: string) => Promise<void>
      searchFiles: (rootPath: string, query: string, maxResults?: number, exts?: string[]) =>
        Promise<{ file: string; line: number; column: number; preview: string; next: string }[]>
      listFiles: (rootPath: string, maxResults?: number) => Promise<string[]>
      watch: (root: string) => Promise<void>
      unwatch: (root: string) => Promise<void>
      onChanged: (cb: (payload: { root: string }) => void) => () => void
    }
    window: {
      minimize: () => void
      maximize: () => void
      close: () => void
      openDetached: (panelId: string) => Promise<boolean>
    }
    updater: {
      install: () => Promise<boolean>
      state: () => Promise<UpdateState>
      check: () => Promise<UpdateState>
      onState: (callback: (state: UpdateState) => void) => () => void
      onDownloaded: (callback: () => void) => () => void
    }
    terminal: {
      create: (cwd: string, type: TerminalTypeEnum) => Promise<string>
      write: (id: string, data: string) => Promise<void>
      resize: (id: string, cols: number, rows: number) => Promise<void>
      destroy: (id: string) => Promise<void>
      onData: (callback: (id: string, data: string) => void) => () => void
    }
    shell: {
      exec: (command: string, cwd: string) => Promise<string>
      openFolder: (path: string) => Promise<void>
      showItemInFolder: (path: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
    }
    app: {
      initialTarget: () => Promise<{ path: string; isDirectory: boolean } | null>
      onOpenPath: (cb: (target: { path: string; isDirectory: boolean }) => void) => () => void
    }
    clipboard: {
      write: (text: string) => void
      read: () => Promise<string>
    }
    process: {
      start: (cwd: string, command: string, args: string[]) => Promise<string>
      stop: (id: string) => Promise<void>
      onOutput: (callback: (id: string, data: string) => void) => () => void
      onExit: (callback: (id: string, code: number | null) => void) => () => void
    }
  }
}

type TerminalTypeEnum = 'cmd' | 'powershell' | 'pwsh' | 'npm'
