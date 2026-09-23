import simpleGit from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { rm, mkdir, rename, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { basename, dirname, join } from 'path'

export interface WorktreeEntry {
  path: string
  head: string
  branch: string
  bare: boolean
  detached: boolean
}

export interface RemoveResult {
  ok: boolean
  // the folder could not be deleted (still locked by another process), but the
  // worktree registration has been pruned: it no longer appears in the list
  warning?: string
  // when the locked folder was moved to the internal trash: the worktree path is
  // free and the deletion is retried in the background
  trashedPath?: string
  error?: string
}

function normalizeForCompare(p: string): string {
  return p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Bounded recursive delete: returns the last error, or null on success. */
async function tryRemove(target: string, attempts: number, delayMs: number): Promise<Error | null> {
  let last: Error | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await rm(target, { recursive: true, force: true })
      return null
    } catch (e) {
      last = e as Error
      await delay(delayMs)
    }
  }
  return last
}

const TRASH_DIR = '.damnedide-trash'
const pendingDeletes = new Map<string, NodeJS.Timeout>()

/**
 * Moves a locked folder to a sibling `.damnedide-trash` directory, freeing the
 * original path immediately. Renaming a directory works even when files inside
 * are held open, while deleting it does not.
 */
export async function moveToTrash(targetPath: string): Promise<string | null> {
  const trashDir = join(dirname(targetPath), TRASH_DIR)
  const dest = join(trashDir, `${basename(targetPath)}-${Date.now()}`)
  try {
    await mkdir(trashDir, { recursive: true })
    // opportunistic cleanup of previous leftovers that are unlocked by now
    for (const entry of await readdir(trashDir).catch(() => [] as string[])) {
      const old = join(trashDir, entry)
      if (old === dest) continue
      await rm(old, { recursive: true, force: true }).catch(() => { /* still locked */ })
    }
    await rename(targetPath, dest)
    return dest
  } catch {
    return null
  }
}

/** Retries the deletion of a trashed folder until the lock is released (bounded). */
export function scheduleDelete(
  targetPath: string,
  opts: { attempts?: number; intervalMs?: number; initialDelayMs?: number } = {}
): void {
  const attempts = opts.attempts ?? 40
  const intervalMs = opts.intervalMs ?? 15_000
  const initialDelayMs = opts.initialDelayMs ?? 5_000
  if (pendingDeletes.has(targetPath)) return
  let left = attempts
  const tick = async () => {
    pendingDeletes.delete(targetPath)
    await rm(targetPath, { recursive: true, force: true }).catch(() => { /* still locked */ })
    if (existsSync(targetPath) && --left > 0) {
      pendingDeletes.set(targetPath, setTimeout(tick, intervalMs))
    }
  }
  pendingDeletes.set(targetPath, setTimeout(tick, initialDelayMs))
}

export function cancelScheduledDeletes(): void {
  for (const timer of pendingDeletes.values()) clearTimeout(timer)
  pendingDeletes.clear()
}

export interface WorktreeServiceHooks {
  /**
   * Closes the Explorer windows showing the folder (Windows): Explorer holds a
   * handle on the displayed directory and that is what makes the delete fail.
   * Injected so this service stays free of platform/process code (and testable).
   */
  closeExplorerWindows?: (path: string) => Promise<number>
}

export class WorktreeService {
  private hooks: WorktreeServiceHooks

  constructor(hooks: WorktreeServiceHooks = {}) {
    this.hooks = hooks
  }

  private getGit(repoPath: string): SimpleGit {
    return simpleGit(repoPath)
  }

  async list(repoPath: string): Promise<WorktreeEntry[]> {
    const git = this.getGit(repoPath)
    let raw: string
    try {
      raw = await git.raw(['worktree', 'list', '--porcelain'])
    } catch {
      throw new Error(`"${repoPath}" non è un repository git: apri la cartella che contiene la directory .git`)
    }

    const entries: WorktreeEntry[] = []
    let current: Partial<WorktreeEntry> = {}

    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) entries.push(current as WorktreeEntry)
        current = { path: line.slice(9), head: '', branch: '', bare: false, detached: false }
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5)
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(15)
      } else if (line.startsWith('bare')) {
        current.bare = true
      } else if (line.startsWith('detached')) {
        current.detached = true
      }
    }

    if (current.path) entries.push(current as WorktreeEntry)
    return entries
  }

  async add(repoPath: string, branch: string, worktreePath: string): Promise<void> {
    const git = this.getGit(repoPath)
    // fail fast with an actionable message instead of git's bare
    // "fatal: not a git repository (or any of the parent directories): .git"
    try {
      await git.raw(['rev-parse', '--git-dir'])
    } catch {
      throw new Error(`"${repoPath}" non è un repository git: apri la cartella che contiene la directory .git`)
    }
    // `git worktree add` creates the leaf directory but not the missing parents
    await mkdir(dirname(worktreePath), { recursive: true }).catch(() => { /* created by git */ })

    // Fetch develop (no tags — faster) so the new branch starts from the latest.
    // If the fetch fails (offline), fall back to the local refs; the worktree add
    // then reports a clear error only if no develop exists at all.
    try {
      await git.fetch(['--no-tags', 'origin', 'develop'])
    } catch { /* offline: proceed with the local ref */ }

    let startPoint = 'origin/develop'
    try {
      await git.raw(['rev-parse', '--verify', startPoint])
    } catch {
      try {
        await git.raw(['rev-parse', '--verify', 'develop'])
        startPoint = 'develop'
      } catch {
        throw new Error(`il repository non ha un branch 'develop' (né origin/develop): fai un fetch o crea il branch prima di creare un worktree`)
      }
    }

    await git.raw(['worktree', 'add', '-b', branch, worktreePath, startPoint])
    // `git worktree add -b <branch> ... origin/develop` auto-tracks the start
    // point, so the new branch would track origin/develop. Point the upstream at
    // the matching remote branch (origin/feature/x or origin/bugfix/x) instead,
    // so status/push/pull operate on the branch's own remote counterpart even
    // before it has been pushed (push then creates it).
    await git.raw(['config', `branch.${branch}.remote`, 'origin'])
    await git.raw(['config', `branch.${branch}.merge`, `refs/heads/${branch}`])
  }

  /**
   * Removes a worktree. Without `force` this is a plain recursive delete: if the
   * folder is locked (a terminal, Explorer, another app) it fails and the caller
   * can ask the user to confirm a forced removal.
   *
   * With `force` we do everything the OS allows: unregister in git, retry the
   * delete, close the Explorer windows showing the folder, and if another
   * process still holds it, move the folder to an internal trash (moving works
   * even while files inside are open) and retry the deletion in the background.
   * The worktree path is therefore always freed; only the disk space may be
   * reclaimed a moment later.
   */
  async remove(repoPath: string, worktreePath: string, force = false): Promise<RemoveResult> {
    // Guard: never delete the main repository itself
    if (normalizeForCompare(worktreePath) === normalizeForCompare(repoPath)) {
      await this.getGit(repoPath).raw(['worktree', 'prune'])
      return { ok: true }
    }

    if (!force) {
      const error = await tryRemove(worktreePath, 1, 0)
      if (error) return { ok: false, error: error.message }
      await this.getGit(repoPath).raw(['worktree', 'prune']).catch(() => {})
      return { ok: true }
    }

    // force: unregister first, then insist on the folder
    await this.getGit(repoPath).raw(['worktree', 'remove', '--force', worktreePath]).catch(() => {})

    let rmError = await tryRemove(worktreePath, 5, 250)

    // Explorer holds the displayed folder: closing its windows usually releases it
    if (rmError && this.hooks.closeExplorerWindows) {
      const closed = await this.hooks.closeExplorerWindows(worktreePath).catch(() => 0)
      if (closed > 0) rmError = await tryRemove(worktreePath, 8, 300)
    }

    await this.getGit(repoPath).raw(['worktree', 'prune']).catch(() => {})

    if (!rmError) return { ok: true }

    // Still locked by another process (VS Code, a shell outside the IDE…):
    // renaming works even with open files, so the worktree path is freed now
    const trashedPath = await moveToTrash(worktreePath)
    if (trashedPath) {
      await rm(trashedPath, { recursive: true, force: true }).catch(() => { /* still locked */ })
      if (existsSync(trashedPath)) scheduleDelete(trashedPath)
      return {
        ok: true,
        trashedPath,
        warning: existsSync(trashedPath)
          ? `worktree rimosso dal repository. La cartella era bloccata ed è stata spostata in "${trashedPath}": verrà eliminata automaticamente appena il file non è più in uso.`
          : undefined
      }
    }

    return {
      ok: true,
      warning: `worktree rimosso dal repository, ma la cartella non è stata eliminata (probabilmente aperta in un altro programma): ${rmError.message}`
    }
  }

  async prune(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.raw(['worktree', 'prune'])
  }
}
