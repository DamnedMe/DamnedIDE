import { readdir, readFile, writeFile } from 'fs/promises'
import { realpathSync } from 'fs'
import { isAbsolute, relative, resolve, join, extname, sep } from 'path'
import { randomBytes } from 'crypto'
import type { DeviceInfo, RemoteScope, WorkspaceSnapshot, RemoteSqlConnection } from '../../../src/shared/remote/protocol'
import { PRODUCT_NAME, PROTOCOL_VERSION } from '../../../src/shared/remote/protocol'
import { GitService } from '../git/git.service'
import { WorktreeService } from '../git/worktree.service'
import { DiffService } from '../git/diff.service'
import { SqlService } from '../sql/sql.service'
import { WorkspaceState } from './workspace-state'
import { PairingService } from './auth/pairing'

export class RemoteCommandError extends Error {
  code: string
  challenge?: unknown
  constructor(code: string, message: string, challenge?: unknown) {
    super(message)
    this.code = code
    this.challenge = challenge
  }
}

export interface RemoteDeps {
  git: GitService
  worktree: WorktreeService
  diff: DiffService
  sql: SqlService
  workspace: WorkspaceState
  pairing: PairingService
  appVersion: string
  platform: string
  /** Live SQL connections (sanitised) mirrored from the renderer. */
  getSqlConnections: () => RemoteSqlConnection[]
}

const MUTATING_SQL = /\b(DROP|TRUNCATE|ALTER|DELETE|UPDATE|INSERT|MERGE|EXEC|EXECUTE|CREATE|GRANT|REVOKE|BACKUP|RESTORE|DBCC)\b/i

/** Rows per result set sent to the phone (the desktop default, 250000, is far too much for it). */
const REMOTE_MAX_ROWS = 10000

/** Id the app picks for its query so `sql.cancel` can reach it; the `remote_` prefix keeps it off the desktop's own. */
const REMOTE_QUERY_ID = /^remote_[\w-]{1,64}$/

function isMutatingSql(query: string): boolean {
  // Strip line/block comments so a commented keyword does not trigger a prompt.
  const stripped = query.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
  return MUTATING_SQL.test(stripped)
}

/** `target` is `root` or a path inside it, compared on disk (8.3 short names, junctions, case). */
function isInside(root: string, target: string): boolean {
  const real = (p: string): string => {
    try {
      return realpathSync.native(p)
    } catch {
      return resolve(p)
    }
  }
  const rel = relative(real(root), real(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Curated, scope-checked command surface exposed to paired devices. It composes
 * the existing IDE services instead of forwarding raw IPC channels.
 */
export class RemoteCommands {
  constructor(private deps: RemoteDeps) {}

  async execute(cmd: string, args: Record<string, unknown>, device: DeviceInfo): Promise<unknown> {
    if (!this.hasScope(device, this.scopeFor(cmd))) {
      throw new RemoteCommandError('forbidden', `Permesso mancante per "${cmd}"`)
    }
    switch (cmd) {
      case 'system.ping':
        return { time: Date.now() }
      case 'system.info':
        return {
          ide: PRODUCT_NAME,
          ideVersion: this.deps.appVersion,
          protocolVersion: PROTOCOL_VERSION,
          platform: this.deps.platform,
          repoPath: this.deps.workspace.get().repoPath
        }

      // ─── Workspace ─────────────────────────────────────────────────────────
      case 'workspace.state':
        return this.deps.workspace.get()
      case 'workspace.setRepo':
        return this.setRepo(args)
      case 'workspace.openWorktree':
        return this.openWorktree(args)

      // ─── Worktrees ─────────────────────────────────────────────────────────
      case 'worktree.list':
        return this.deps.worktree.list(await this.repo(args))
      case 'worktree.add':
        return this.deps.worktree.add(await this.repo(args), String(args.branch), String(args.path), args.base ? String(args.base) : undefined)
      case 'worktree.remove': {
        const repoPath = await this.repo(args)
        const worktreePath = String(args.worktreePath)
        this.confirm(cmd, args, `Rimuovere il worktree "${worktreePath}"?`, undefined, true)
        // removeSafe refuses (skipped + error, nothing touched) uncommitted changes, unpushed commits,
        // the main checkout, bare and nested worktrees: the phone shows why
        // ponytail: no forced retry from the phone; a locked folder is reported and forced from the desktop
        return this.deps.worktree.removeSafe(repoPath, worktreePath)
      }
      case 'worktree.promote':
        return this.deps.worktree.retargetChildren(await this.repo(args), String(args.branch ?? args.worktreePath))

      // ─── Git ───────────────────────────────────────────────────────────────
      case 'git.status':
        return this.deps.git.status(await this.repo(args))
      case 'git.porcelain':
        return this.deps.git.porcelain(await this.repo(args))
      case 'git.diff': {
        const repoPath = await this.repo(args)
        // absolute: `git diff <path>` cannot mistake it for a branch named like the file
        const { abs } = this.repoFile(repoPath, args.file)
        return args.staged ? this.deps.diff.staged(repoPath, abs) : this.deps.diff.unstaged(repoPath, abs)
      }
      case 'git.file': {
        const repoPath = await this.repo(args)
        // `<ref>:<path>` only takes a path relative to the repository root
        const { rel } = this.repoFile(repoPath, args.file)
        // `git show -…` would read it as an option (--output=<file> writes anywhere)
        if (args.ref && String(args.ref).startsWith('-')) throw new RemoteCommandError('invalid_args', `Riferimento git non valido: "${String(args.ref)}"`)
        const content = args.ref ? await this.deps.git.showRef(repoPath, rel, String(args.ref)) : await this.deps.git.showFile(repoPath, rel)
        return { content }
      }
      case 'git.stage':
        return this.deps.git.stage(await this.repo(args), (args.files as string[]) ?? [])
      case 'git.unstage':
        return this.deps.git.unstage(await this.repo(args), (args.files as string[]) ?? [])
      case 'git.commit':
        return this.deps.git.commit(await this.repo(args), String(args.message))
      case 'git.pull':
        return this.deps.git.pull(await this.repo(args))
      case 'git.push':
        return this.deps.git.push(await this.repo(args))
      case 'git.discard': {
        const repoPath = await this.repo(args)
        // checked before the prompt: with `untracked` the file is deleted from disk, and an
        // unchecked "../x" would reach outside the workspace
        const { rel: file } = this.repoFile(repoPath, args.file)
        this.confirm(cmd, args, `Scartare le modifiche a "${file}"?`, 'Le modifiche non recuperabili andranno perse.', true)
        return this.deps.git.discardChanges(repoPath, file, { staged: !!args.staged, untracked: !!args.untracked })
      }

      // ─── Filesystem (sandboxed to the open workspace) ──────────────────────
      case 'fs.tree':
        return this.readDir(this.assertInsideWorkspace(String(args.root)))
      case 'fs.read':
        return { content: await readFile(this.assertInsideWorkspace(String(args.file)), 'utf-8') }
      case 'fs.write':
        await writeFile(this.assertInsideWorkspace(String(args.file)), String(args.content ?? ''), 'utf-8')
        return { ok: true }
      case 'fs.list':
        return this.listFiles(this.assertInsideWorkspace(String(args.root)), Number(args.maxResults) || 100000)
      case 'fs.search':
        return this.searchFiles(this.assertInsideWorkspace(String(args.root)), String(args.query ?? ''), Number(args.maxResults) || 300, args.exts as string[] | undefined)

      // ─── Editor (mirror + save) ────────────────────────────────────────────
      case 'editor.open': {
        const rootPath = this.assertInsideWorkspace(String(args.rootPath))
        const filePath = this.assertInsideWorkspace(String(args.filePath))
        const apply = { type: 'editor.open' as const, rootPath, filePath, line: Number(args.line) || 1, previewMd: !!args.previewMd }
        this.deps.workspace.apply(apply)
        return this.deps.workspace.update({ editorNav: { rootPath, filePath, line: Number(args.line) || 1, previewMd: !!args.previewMd } })
      }
      case 'editor.save':
        await writeFile(this.assertInsideWorkspace(String(args.file)), String(args.content ?? ''), 'utf-8')
        return { ok: true }

      // ─── SQL (connections live on the desktop; credentials never leave) ─────
      case 'sql.connections':
        return this.deps.getSqlConnections()
      case 'sql.databases':
        return this.deps.sql.listDatabases(String(args.connectionId))
      case 'sql.tables':
        return this.deps.sql.listTables(String(args.connectionId), String(args.database))
      case 'sql.columns':
        return this.deps.sql.listColumns(String(args.connectionId), String(args.database), String(args.table))
      case 'sql.objectDefinition':
        return this.deps.sql.objectDefinition(String(args.connectionId), String(args.database), String(args.objectName))
      case 'sql.query': {
        const query = String(args.query ?? '')
        if (isMutatingSql(query)) {
          this.confirm(cmd, args, 'Eseguire una query che modifica i dati?', query, true)
        }
        const database = args.database ? String(args.database) : undefined
        // executeQuery only labels the results with `database`: switch to it in the batch, as the SQL panel does
        const batch = database ? `USE [${database.replace(/]/g, ']]')}];\n${query}` : query
        const maxRows = typeof args.maxRows === 'number' && Number.isFinite(args.maxRows)
          ? Math.min(REMOTE_MAX_ROWS, Math.max(1, Math.floor(args.maxRows)))
          : REMOTE_MAX_ROWS
        const queryId = typeof args.queryId === 'string' && REMOTE_QUERY_ID.test(args.queryId) ? args.queryId : `remote_${randomBytes(6).toString('hex')}`
        return this.deps.sql.executeQuery(String(args.connectionId), batch, queryId, maxRows, database)
      }
      case 'sql.cancel':
        this.deps.sql.cancelQuery(String(args.queryId))
        return { ok: true }

      default:
        throw new RemoteCommandError('unknown_command', `Comando sconosciuto: ${cmd}`)
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private hasScope(device: DeviceInfo, scope: RemoteScope): boolean {
    return device.scopes.includes(scope)
  }

  private scopeFor(cmd: string): RemoteScope {
    if (cmd.startsWith('sql.')) {
      if (cmd === 'sql.backup' || cmd === 'sql.restore' || cmd === 'sql.dataTier') return 'sqlDestructive'
      // cancelling stops a running query: only who may run them
      if (cmd === 'sql.query' || cmd === 'sql.cancel') return 'sql'
      return 'view'
    }
    if (cmd === 'fs.write' || cmd === 'editor.save') return 'edit'
    if (cmd === 'worktree.add' || cmd === 'worktree.remove' || cmd === 'worktree.promote' || cmd === 'git.discard') return 'git'
    // reading changes is "view": a read-only phone must still list and diff them
    if (cmd === 'git.status' || cmd === 'git.porcelain' || cmd === 'git.diff' || cmd === 'git.file') return 'view'
    if (cmd.startsWith('git.')) return 'git'
    return 'view'
  }

  private confirm(cmd: string, args: Record<string, unknown>, summary: string, details: string | undefined, destructive: boolean): void {
    const supplied = typeof args.confirm === 'string' ? args.confirm : ''
    if (supplied && this.deps.pairing.resolveChallenge(supplied, cmd)) return
    const challenge = this.deps.pairing.challenge(cmd, summary, details, destructive)
    throw new RemoteCommandError('confirmation_required', summary, challenge)
  }

  /**
   * The repository a command runs on: the open one, or the `repoPath` the app sent when it is the
   * open repository, one of its worktrees (the selected one) or a folder inside them.
   */
  private async repo(args: Record<string, unknown>): Promise<string> {
    const open = this.deps.workspace.get().repoPath
    if (!open) throw new RemoteCommandError('no_repo', 'Nessun repository aperto sul desktop')
    const explicit = typeof args.repoPath === 'string' && args.repoPath ? args.repoPath : null
    if (!explicit || isInside(open, explicit)) return explicit || open
    // ponytail: a worktree outside the checkout costs one `git worktree list` per command, not cached
    const worktrees = await this.deps.worktree.list(open).catch(() => [])
    if (worktrees.some((w) => isInside(w.path, explicit))) return explicit
    throw new RemoteCommandError('outside_workspace', 'Repository fuori dall\'area di lavoro aperta')
  }

  private async setRepo(args: Record<string, unknown>): Promise<WorkspaceSnapshot> {
    const input = String(args.repoPath ?? '')
    const root = await this.deps.git.resolveRepoRoot(input)
    if (!root) throw new RemoteCommandError('not_a_repo', `"${input}" non è un repository git`)
    this.deps.workspace.apply({ type: 'workspace.setRepo', repoPath: root })
    return this.deps.workspace.update({ repoPath: root, selectedWorktree: null })
  }

  private async openWorktree(args: Record<string, unknown>): Promise<WorkspaceSnapshot> {
    const path = String(args.path ?? '')
    // the selected worktree becomes a sandbox root (allowedRoots): only a worktree of the open repository
    const open = this.deps.workspace.get().repoPath
    if (!open) throw new RemoteCommandError('no_repo', 'Nessun repository aperto sul desktop')
    const worktrees = await this.deps.worktree.list(open).catch(() => [])
    if (!worktrees.some((w) => !w.bare && isInside(w.path, path) && isInside(path, w.path))) {
      throw new RemoteCommandError('outside_workspace', 'Non è un worktree del repository aperto')
    }
    this.deps.workspace.apply({ type: 'workspace.openWorktree', path })
    return this.deps.workspace.update({ selectedWorktree: path })
  }

  /** Allowed roots: the open repo, the selected worktree and the editor root. */
  private allowedRoots(): string[] {
    const ws = this.deps.workspace.get()
    return [ws.repoPath, ws.selectedWorktree, ws.editorNav?.rootPath].filter((p): p is string => !!p)
  }

  private assertInsideWorkspace(target: string): string {
    const roots = this.allowedRoots()
    if (roots.length === 0) throw new RemoteCommandError('no_repo', 'Nessun repository aperto sul desktop')
    const abs = resolve(target)
    for (const root of roots) {
      const rel = relative(resolve(root), abs)
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return abs
    }
    throw new RemoteCommandError('outside_workspace', 'Percorso fuori dall\'area di lavoro aperta')
  }

  /**
   * A file of `repoPath` as the app sends it: relative to the repository (as git.porcelain lists
   * it) or absolute. Resolved against the repository, not the process cwd, then sandboxed.
   */
  private repoFile(repoPath: string, file: unknown): { abs: string; rel: string } {
    const abs = this.assertInsideWorkspace(resolve(repoPath, String(file ?? '')))
    return { abs, rel: relative(resolve(repoPath), abs).split(sep).join('/') }
  }

  private async readDir(dirPath: string): Promise<{ name: string; isDirectory: boolean; isFile: boolean }[]> {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries
      .filter((e) => !e.name.startsWith('.') || e.name === '.gitignore')
      .map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }))
  }

  private async listFiles(rootPath: string, maxResults: number): Promise<string[]> {
    const results: string[] = []
    const skipDirs = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'out', '.vs', 'packages', '.worktrees'])
    const walk = async (dir: string): Promise<void> => {
      if (results.length >= maxResults) return
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      // a subfolder listing `.git` is a nested worktree or repository (worktrees can live inside
      // the checkout under any name, not only `.worktrees`): a copy of the sources, skip it.
      // ponytail: no extra syscall, the readdir already lists it; the nested root is read once
      if (dir !== rootPath && entries.some((e) => e.name === '.git')) return
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
  }

  private async searchFiles(rootPath: string, query: string, maxResults: number, exts?: string[]): Promise<unknown[]> {
    if (!query || query.length < 2) return []
    const lower = query.toLowerCase()
    const extSet = exts?.length ? new Set(exts.map((e) => e.toLowerCase())) : null
    const files: string[] = []
    const skipDirs = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'out', '.vs', 'packages', '.worktrees'])
    const collect = async (dir: string): Promise<void> => {
      if (files.length > 20000) return
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      // nested worktree or repository (any folder name): same rule as listFiles
      if (dir !== rootPath && entries.some((e) => e.name === '.git')) return
      const sub: Promise<void>[] = []
      for (const e of entries) {
        if (e.name.startsWith('.') || skipDirs.has(e.name)) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) sub.push(collect(full))
        else if (e.isFile() && (!extSet || extSet.has(extname(e.name).toLowerCase()))) files.push(full)
      }
      await Promise.all(sub)
    }
    await collect(rootPath)
    const results: unknown[] = []
    for (const file of files) {
      if (results.length >= maxResults) break
      try {
        const content = await readFile(file, 'utf-8')
        if (content.includes('\0')) continue
        const lines = content.split('\n')
        for (let ln = 0; ln < lines.length && results.length < maxResults; ln++) {
          const idx = lines[ln].toLowerCase().indexOf(lower)
          if (idx >= 0) results.push({ file, line: ln + 1, column: idx + 1, preview: lines[ln].slice(0, 200).trim() })
        }
      } catch {
        /* binary or unreadable */
      }
    }
    return results
  }
}
