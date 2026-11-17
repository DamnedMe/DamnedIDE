// The DamnedIDE features an agent sees as MCP tools: each tool is one command of the curated
// remote surface (electron/services/remote/commands.ts), so scopes, sandbox and confirmations
// are the ones the DamnedCloud phone already has. Pure data + argument mapping, no electron.
import { isAbsolute, resolve } from 'path'

export interface IdeTool {
  name: string
  description: string
  /** JSON Schema of the tool arguments */
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
  /** remote command it runs */
  cmd: string
  /** argument names holding a path: relative ones resolve against the active root */
  paths?: string[]
  /** the command takes `repoPath`: the active root when the agent omits it */
  repo?: boolean
  /** extra arguments the command needs from the workspace */
  fill?: (root: string) => Record<string, unknown>
  readOnly?: boolean
}

const str = (description: string) => ({ type: 'string', description })
const bool = (description: string) => ({ type: 'boolean', description })
const num = (description: string) => ({ type: 'number', description })
const repoPath = str('Repository or worktree folder (default: the one open in DamnedIDE)')
const obj = (properties: Record<string, unknown>, required?: string[]): IdeTool['inputSchema'] =>
  ({ type: 'object', properties, ...(required ? { required } : {}), additionalProperties: false })

const stage = { type: 'string', enum: ['dev-qa', 'qa-prod', 'dev-qa-prod'], description: 'dev-qa, qa-prod or dev-qa-prod (the chain)' }
const scope = { type: 'string', enum: ['be', 'fe', 'both'], description: 'BE repository, FE repository or both' }

export const IDE_TOOLS: IdeTool[] = [
  // ─── workspace ───
  { name: 'ide_workspace', cmd: 'workspace.state', readOnly: true, inputSchema: obj({}),
    description: 'What is open in DamnedIDE: repository, selected worktree, active panel, file in the editor. Call it first: relative paths of the other tools resolve against the selected worktree (or the repository).' },
  { name: 'ide_open_repository', cmd: 'workspace.setRepo', paths: ['repoPath'], inputSchema: obj({ repoPath: str('Folder of a git repository') }, ['repoPath']),
    description: 'Open another repository in DamnedIDE (the desktop switches to it).' },
  { name: 'ide_open_file', cmd: 'editor.open', paths: ['filePath'], fill: (root) => ({ rootPath: root }),
    inputSchema: obj({ filePath: str('File to show'), line: num('1-based line to reveal') }, ['filePath']),
    description: 'Show a file in the DamnedIDE editor, scrolled to a line, so the user sees what you are talking about.' },

  // ─── worktrees ───
  { name: 'worktree_list', cmd: 'worktree.list', repo: true, readOnly: true, inputSchema: obj({ repoPath }),
    description: 'Git worktrees of the open repository (path, branch, head).' },
  { name: 'worktree_select', cmd: 'workspace.openWorktree', paths: ['path'], inputSchema: obj({ path: str('Worktree folder') }, ['path']),
    description: 'Select a worktree in DamnedIDE (it becomes the active root).' },
  { name: 'worktree_add', cmd: 'worktree.add', repo: true, paths: ['path'],
    inputSchema: obj({ branch: str('New branch name'), path: str('Folder of the new worktree'), base: str('Base branch (default: current HEAD)'), repoPath }, ['branch', 'path']),
    description: 'Create a git worktree on a new branch.' },
  { name: 'worktree_remove', cmd: 'worktree.remove', repo: true, paths: ['worktreePath'],
    inputSchema: obj({ worktreePath: str('Worktree folder to remove'), repoPath }, ['worktreePath']),
    description: 'Remove a worktree; refused with uncommitted changes or unpushed commits. The user confirms it in DamnedIDE.' },

  // ─── git ───
  { name: 'git_changes', cmd: 'git.porcelain', repo: true, readOnly: true, inputSchema: obj({ repoPath }),
    description: 'Changed files: staged, unstaged and conflicts, with their change type.' },
  { name: 'git_status', cmd: 'git.status', repo: true, readOnly: true, inputSchema: obj({ repoPath }),
    description: 'Branch, ahead/behind and file status of the repository.' },
  { name: 'git_diff', cmd: 'git.diff', repo: true, readOnly: true,
    inputSchema: obj({ file: str('File, relative to the repository or absolute'), staged: bool('Staged diff instead of the working tree'), repoPath }, ['file']),
    description: 'Unified diff of one file.' },
  { name: 'git_file_at', cmd: 'git.file', repo: true, readOnly: true,
    inputSchema: obj({ file: str('File, relative to the repository'), ref: str('Commit, branch or tag (default: HEAD)'), repoPath }, ['file']),
    description: 'Content of a file at a git revision.' },
  { name: 'git_stage', cmd: 'git.stage', repo: true, inputSchema: obj({ files: { type: 'array', items: { type: 'string' }, description: 'Files relative to the repository' }, repoPath }, ['files']),
    description: 'Stage files.' },
  { name: 'git_unstage', cmd: 'git.unstage', repo: true, inputSchema: obj({ files: { type: 'array', items: { type: 'string' }, description: 'Files relative to the repository' }, repoPath }, ['files']),
    description: 'Unstage files.' },
  { name: 'git_commit', cmd: 'git.commit', repo: true, inputSchema: obj({ message: str('Commit message'), repoPath }, ['message']),
    description: 'Commit the staged changes.' },
  { name: 'git_pull', cmd: 'git.pull', repo: true, inputSchema: obj({ repoPath }), description: 'Pull the current branch.' },
  { name: 'git_push', cmd: 'git.push', repo: true, inputSchema: obj({ repoPath }), description: 'Push the current branch.' },
  { name: 'git_discard', cmd: 'git.discard', repo: true,
    inputSchema: obj({ file: str('File relative to the repository'), staged: bool('Also unstage it'), untracked: bool('The file is untracked: delete it'), repoPath }, ['file']),
    description: 'Discard the changes to a file. The user confirms it in DamnedIDE.' },

  // ─── files (sandboxed to the open repository and worktree) ───
  { name: 'file_read', cmd: 'fs.read', paths: ['file'], readOnly: true, inputSchema: obj({ file: str('File path') }, ['file']),
    description: 'Read a text file of the workspace.' },
  { name: 'file_write', cmd: 'fs.write', paths: ['file'], inputSchema: obj({ file: str('File path'), content: str('Whole new content') }, ['file', 'content']),
    description: 'Write a text file of the workspace (whole content).' },
  { name: 'file_tree', cmd: 'fs.tree', paths: ['root'], readOnly: true, inputSchema: obj({ root: str('Folder (default: the active root)') }),
    description: 'Entries of one folder.' },
  { name: 'file_list', cmd: 'fs.list', paths: ['root'], readOnly: true,
    inputSchema: obj({ root: str('Folder (default: the active root)'), maxResults: num('Maximum files (default 100000)') }),
    description: 'Every file under a folder, skipping node_modules, bin, obj, .git and nested worktrees.' },
  { name: 'file_search', cmd: 'fs.search', paths: ['root'], readOnly: true,
    inputSchema: obj({ query: str('Text to find (case-insensitive, at least 2 characters)'), root: str('Folder (default: the active root)'), exts: { type: 'array', items: { type: 'string' }, description: 'Extensions, e.g. [".cs"]' }, maxResults: num('Maximum matches (default 300)') }, ['query']),
    description: 'Search text in the workspace files: file, line, column and preview of each match.' },

  // ─── SQL (connections open on the desktop; credentials never leave it) ───
  { name: 'sql_connections', cmd: 'sql.connections', readOnly: true, inputSchema: obj({}),
    description: 'SQL Server connections open in DamnedIDE (id, label, server, database).' },
  { name: 'sql_databases', cmd: 'sql.databases', readOnly: true, inputSchema: obj({ connectionId: str('Connection id') }, ['connectionId']),
    description: 'Databases of a connection.' },
  { name: 'sql_tables', cmd: 'sql.tables', readOnly: true, inputSchema: obj({ connectionId: str('Connection id'), database: str('Database') }, ['connectionId', 'database']),
    description: 'Tables, views and routines of a database.' },
  { name: 'sql_columns', cmd: 'sql.columns', readOnly: true,
    inputSchema: obj({ connectionId: str('Connection id'), database: str('Database'), table: str('Table') }, ['connectionId', 'database', 'table']),
    description: 'Columns of a table.' },
  { name: 'sql_object_definition', cmd: 'sql.objectDefinition', readOnly: true,
    inputSchema: obj({ connectionId: str('Connection id'), database: str('Database'), objectName: str('View, procedure or function') }, ['connectionId', 'database', 'objectName']),
    description: 'T-SQL definition of a view, procedure or function.' },
  { name: 'sql_query', cmd: 'sql.query',
    inputSchema: obj({ connectionId: str('Connection id'), query: str('T-SQL batch'), database: str('Database to run it in'), maxRows: num('Rows per result set (at most 10000)') }, ['connectionId', 'query']),
    description: 'Run T-SQL on an open connection. A query that changes data or schema is confirmed by the user in DamnedIDE.' },

  // ─── release (Azure DevOps, as the desktop Release panel) ───
  { name: 'release_state', cmd: 'release.state', repo: true, readOnly: true, inputSchema: obj({ repoPath }),
    description: 'Azure DevOps project of the open repository: BE / FE repositories and the release chains.' },
  { name: 'release_preview', cmd: 'release.preview', repo: true, readOnly: true, inputSchema: obj({ stage, scope, repoPath }, ['stage', 'scope']),
    description: 'What a promotion would bring: branches, commits, work items and active PRs of each repository.' },
  { name: 'release_create', cmd: 'release.create', repo: true,
    inputSchema: obj({ stage: { ...stage, enum: ['dev-qa', 'qa-prod'] }, scope, autoComplete: bool('Arm auto-complete (branch policies are never bypassed)'), excluded: { type: 'array', items: { type: 'string' }, description: 'Work items not to link, as "BE:1234"' }, repoPath }, ['stage', 'scope']),
    description: 'Create the promotion pull requests (develop → qa or qa → prod). qa → prod is confirmed by the user in DamnedIDE.' },
  { name: 'release_chain_start', cmd: 'release.chainStart', repo: true,
    inputSchema: obj({ scope, autoComplete: bool('Arm auto-complete on the PRs the chain creates'), excluded: { type: 'array', items: { type: 'string' }, description: 'Work items not to link, as "BE:1234"' }, repoPath }, ['scope']),
    description: 'Start the chain develop → qa → prod: DamnedIDE creates each qa → prod PR when its develop → qa one is completed. Confirmed by the user.' },
  { name: 'release_chain_cancel', cmd: 'release.chainCancel', inputSchema: obj({ id: str('Chain id (release_state)') }, ['id']),
    description: 'Stop a release chain; the PRs already created stay in Azure DevOps.' }
]

/** Root the agent works in: the worktree selected in DamnedIDE, else the open repository. */
export function activeRoot(ws: { repoPath: string | null; selectedWorktree: string | null }): string | null {
  return ws.selectedWorktree || ws.repoPath
}

/**
 * The command arguments of a tool call: relative paths resolved against `root` (the command
 * layer sandboxes them), `repoPath` defaulted to it, folders defaulted to it, the extra
 * arguments filled. `confirm` from the agent is dropped: only the desktop dialog confirms.
 */
export function commandArgs(tool: IdeTool, raw: unknown, root: string | null): Record<string, unknown> {
  const args: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
  delete args.confirm
  if (root) {
    for (const key of tool.paths ?? []) {
      const v = args[key]
      if (typeof v === 'string' && v.trim()) args[key] = isAbsolute(v) ? v : resolve(root, v)
      else if (key === 'root') args[key] = root
    }
    if (tool.repo && !(typeof args.repoPath === 'string' && args.repoPath)) args.repoPath = root
    else if (tool.repo && typeof args.repoPath === 'string' && !isAbsolute(args.repoPath)) args.repoPath = resolve(root, args.repoPath)
    Object.assign(args, tool.fill?.(root))
  }
  return args
}
