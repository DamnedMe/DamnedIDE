import simpleGit, { SimpleGit } from 'simple-git'

export class DiffService {
  private getGit(repoPath: string): SimpleGit {
    return simpleGit(repoPath)
  }

  async unstaged(repoPath: string, file: string): Promise<string> {
    const git = this.getGit(repoPath)
    return git.diff([file])
  }

  async staged(repoPath: string, file: string): Promise<string> {
    const git = this.getGit(repoPath)
    return git.diff(['--cached', file])
  }

  async branchDiff(repoPath: string, branchA: string, branchB: string): Promise<string> {
    const git = this.getGit(repoPath)
    return git.diff([branchA, branchB])
  }
}
