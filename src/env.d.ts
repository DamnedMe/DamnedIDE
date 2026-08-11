/// <reference types="vite/client" />

interface SqlConnectionConfig {
  server: string
  database?: string
  user?: string
  password?: string
  port?: number
  trustServerCertificate?: boolean
  connectionId?: string
}

interface Window {
  electronAPI: {
    git: {
      status: (repoPath: string) => Promise<import('./types/git').GitStatus>
      porcelain: (repoPath: string) => Promise<{ staged: { path: string; changeType: string }[]; unstaged: { path: string; changeType: string }[] }>
      stage: (repoPath: string, files: string[]) => Promise<void>
      unstage: (repoPath: string, files: string[]) => Promise<void>
      commit: (repoPath: string, message: string) => Promise<void>
      branches: (repoPath: string) => Promise<import('./types/git').BranchInfo[]>
      log: (repoPath: string, count: number) => Promise<import('./types/git').CommitInfo[]>
      pull: (repoPath: string) => Promise<void>
      push: (repoPath: string) => Promise<void>
      fetch: (repoPath: string) => Promise<void>
      showFile: (repoPath: string, filePath: string) => Promise<string>
      showRef: (repoPath: string, filePath: string, ref: string) => Promise<string>
      stageAll: (repoPath: string) => Promise<void>
      pushWithUpstream: (repoPath: string) => Promise<void>
      merge: (repoPath: string, branch: string) => Promise<{ ok: boolean; message: string; conflicts: string[] }>
      currentBranch: (repoPath: string) => Promise<string>
      blame: (repoPath: string, filePath: string) => Promise<{ hash: string; author: string; date: string; line: string }[]>
      fileLog: (repoPath: string, filePath: string, count?: number) => Promise<import('./types/git').CommitInfo[]>
      diffFile: (repoPath: string, filePath: string) => Promise<string>
    }
    worktree: {
      list: (repoPath: string) => Promise<WorktreeEntry[]>
      add: (repoPath: string, branch: string, path: string) => Promise<void>
      remove: (repoPath: string, worktreePath: string) => Promise<void>
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
      connect: (config: SqlConnectionConfig) => Promise<string>
      disconnect: (connectionId: string) => Promise<void>
      query: (connectionId: string, query: string) => Promise<import('./types/sql').SqlQueryResult>
      databases: (connectionId: string) => Promise<string[]>
      tables: (connectionId: string, database: string) => Promise<string[]>
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
    }
    fs: {
      readDir: (dirPath: string) => Promise<{ name: string; isDirectory: boolean; isFile: boolean }[]>
      readFile: (filePath: string) => Promise<string>
      writeFile: (filePath: string, content: string) => Promise<void>
      removeDir: (dirPath: string) => Promise<void>
      delete: (targetPath: string) => Promise<void>
      mkdir: (dirPath: string) => Promise<void>
      searchFiles: (rootPath: string, query: string, maxResults?: number) =>
        Promise<{ file: string; line: number; column: number; preview: string }[]>
      listFiles: (rootPath: string, maxResults?: number) => Promise<string[]>
    }
    window: {
      minimize: () => void
      maximize: () => void
      close: () => void
      openDetached: (panelId: string) => Promise<boolean>
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
    }
    clipboard: {
      write: (text: string) => void
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
