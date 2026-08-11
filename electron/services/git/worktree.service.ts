import simpleGit, { SimpleGit } from 'simple-git'
import { rm } from 'fs/promises'

export interface WorktreeEntry {
  path: string
  head: string
  branch: string
  bare: boolean
  detached: boolean
}

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
    // Fetch develop, then create the worktree with a new branch starting from origin/develop
    await git.fetch(['origin', 'develop'])
    await git.raw(['worktree', 'add', '-b', branch, worktreePath, 'origin/develop'])
  }

  async remove(repoPath: string, worktreePath: string): Promise<void> {
    // Guard: never delete the main repository itself
    if (worktreePath === repoPath) {
      await this.getGit(repoPath).raw(['worktree', 'prune'])
      return
    }
    // Delete the entire folder regardless of git state
    await rm(worktreePath, { recursive: true, force: true })
    // Clean up the worktree registration from the main repo
    await this.getGit(repoPath).raw(['worktree', 'prune'])
  }

  async prune(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.raw(['worktree', 'prune'])
  }
}
