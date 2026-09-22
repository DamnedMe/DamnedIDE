import simpleGit from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { rm } from 'fs/promises'

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
  error?: string
}

function normalizeForCompare(p: string): string {
  return p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class WorktreeService {
  private getGit(repoPath: string): SimpleGit {
    return simpleGit(repoPath)
  }

  async list(repoPath: string): Promise<WorktreeEntry[]> {
    const git = this.getGit(repoPath)
    const raw = await git.raw(['worktree', 'list', '--porcelain'])

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
    // Fetch develop (no tags — faster) so the new branch starts from the latest.
    // If the fetch fails (offline), fall back to the local origin/develop ref; the
    // worktree add then reports a clear error only if that ref is missing too.
    try {
      await git.fetch(['--no-tags', 'origin', 'develop'])
    } catch { /* offline: proceed with the local ref */ }
    await git.raw(['worktree', 'add', '-b', branch, worktreePath, 'origin/develop'])
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
   * can ask the user to confirm a forced removal. With `force` we unregister the
   * worktree in git first (`worktree remove --force`), retry the folder delete a
   * few times, then prune: the entry disappears from the list even when an
   * external process still holds the folder (a warning is returned instead).
   */
  async remove(repoPath: string, worktreePath: string, force = false): Promise<RemoveResult> {
    // Guard: never delete the main repository itself
    if (normalizeForCompare(worktreePath) === normalizeForCompare(repoPath)) {
      await this.getGit(repoPath).raw(['worktree', 'prune'])
      return { ok: true }
    }

    if (!force) {
      try {
        await rm(worktreePath, { recursive: true, force: true })
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
      await this.getGit(repoPath).raw(['worktree', 'prune']).catch(() => {})
      return { ok: true }
    }

    // force: unregister first, then insist on the folder
    await this.getGit(repoPath).raw(['worktree', 'remove', '--force', worktreePath]).catch(() => {})
    let rmError: Error | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(worktreePath, { recursive: true, force: true })
        rmError = null
        break
      } catch (e) {
        rmError = e as Error
        await delay(250)
      }
    }
    await this.getGit(repoPath).raw(['worktree', 'prune']).catch(() => {})
    if (rmError) {
      return {
        ok: true,
        warning: `worktree rimosso dal repository, ma la cartella non è stata eliminata (probabilmente aperta in un altro programma): ${rmError.message}`
      }
    }
    return { ok: true }
  }

  async prune(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.raw(['worktree', 'prune'])
  }
}
