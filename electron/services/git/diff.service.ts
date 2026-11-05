import simpleGit, { SimpleGit } from 'simple-git'
import { NO_OPTIONAL_LOCKS } from './git.service'

export class DiffService {
  private getGit(repoPath: string): SimpleGit {
    return simpleGit(repoPath)
  }

  // re-read on every file change: no optional index lock (see NO_OPTIONAL_LOCKS)
  async unstaged(repoPath: string, file: string): Promise<string> {
    const git = this.getGit(repoPath)
    return git.raw([NO_OPTIONAL_LOCKS, 'diff', file])
  }

  async staged(repoPath: string, file: string): Promise<string> {
    const git = this.getGit(repoPath)
    return git.raw([NO_OPTIONAL_LOCKS, 'diff', '--cached', file])
  }

  async branchDiff(repoPath: string, branchA: string, branchB: string): Promise<string> {
    const git = this.getGit(repoPath)
    return git.diff([branchA, branchB])
  }
}
