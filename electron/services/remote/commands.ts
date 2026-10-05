import { readdir, readFile, writeFile } from 'fs/promises'
import { isAbsolute, relative, resolve, join, extname } from 'path'
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

function isMutatingSql(query: string): boolean {
  // Strip line/block comments so a commented keyword does not trigger a prompt.
  const stripped = query.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
  return MUTATING_SQL.test(stripped)
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
        return this.deps.worktree.remove(repoPath, worktreePath, !!args.force)
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
        const file = this.assertInsideWorkspace(String(args.file))
        return args.staged ? this.deps.diff.staged(repoPath, file) : this.deps.diff.unstaged(repoPath, file)
      }
      case 'git.file': {
        const repoPath = await this.repo(args)
        const file = String(args.file)
        const content = args.ref ? await this.deps.git.showRef(repoPath, file, String(args.ref)) : await this.deps.git.showFile(repoPath, file)
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
        const file = String(args.file)
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
        return this.deps.sql.executeQuery(
          String(args.connectionId),
          query,
          `remote_${randomBytes(6).toString('hex')}`,
          args.maxRows ? Number(args.maxRows) : undefined,
          args.database ? String(args.database) : undefined
        )
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
      if (cmd === 'sql.query') return 'sql'
      return 'view'
    }
    if (cmd === 'fs.write' || cmd === 'editor.save') return 'edit'
    if (cmd === 'worktree.remove' || cmd === 'git.discard') return 'git'
    if (cmd.startsWith('git.')) return 'git'
    return 'view'
  }

  private confirm(cmd: string, args: Record<string, unknown>, summary: string, details: string | undefined, destructive: boolean): void {
    const supplied = typeof args.confirm === 'string' ? args.confirm : ''
    if (supplied && this.deps.pairing.resolveChallenge(supplied, cmd)) return
    const challenge = this.deps.pairing.challenge(cmd, summary, details, destructive)
    throw new RemoteCommandError('confirmation_required', summary, challenge)
  }

  private async repo(args: Record<string, unknown>): Promise<string> {
    const explicit = typeof args.repoPath === 'string' ? args.repoPath : null
    const repoPath = explicit || this.deps.workspace.get().repoPath
    if (!repoPath) throw new RemoteCommandError('no_repo', 'Nessun repository aperto sul desktop')
    return repoPath
  }

  private async setRepo(args: Record<string, unknown>): Promise<WorkspaceSnapshot> {
    const input = String(args.repoPath ?? '')
    const root = await this.deps.git.resolveRepoRoot(input)
    if (!root) throw new RemoteCommandError('not_a_repo', `"${input}" non è un repository git`)
    this.deps.workspace.apply({ type: 'workspace.setRepo', repoPath: root })
    return this.deps.workspace.update({ repoPath: root, selectedWorktree: null })
  }

  private openWorktree(args: Record<string, unknown>): WorkspaceSnapshot {
    const path = String(args.path ?? '')
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
