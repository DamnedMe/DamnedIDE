import simpleGit from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { rm } from 'fs/promises'
import { join } from 'path'

export interface SerializableGitStatus {
  current: string
  tracking: string
  conflicted: string[]
  created: string[]
  deleted: string[]
  modified: string[]
  not_added: string[]
  staged: string[]
  ahead: number
  behind: number
  isClean: boolean
}

export interface SerializableBranchInfo {
  name: string
  current: boolean
  remote: boolean
}

export interface SerializableCommitInfo {
  hash: string
  date: string
  message: string
  authorName: string
  authorEmail: string
}

export class GitService {
  private getGit(repoPath: string): SimpleGit {
    return simpleGit(repoPath)
  }

  async status(repoPath: string): Promise<SerializableGitStatus> {
    const s = await this.getGit(repoPath).status()
    return {
      current: s.current ?? '',
      tracking: s.tracking ?? '',
      conflicted: s.conflicted,
      created: s.created,
      deleted: s.deleted,
      modified: s.modified,
      not_added: s.not_added,
      staged: s.staged,
      ahead: s.ahead,
      behind: s.behind,
      isClean: s.isClean()
    }
  }

  /**
   * Precise staged/unstaged split from `git status --porcelain`, avoiding the
   * duplication that simple-git's categorized arrays can produce (e.g. staged
   * files also reported as modified due to line-ending normalisation).
   */
  async porcelain(repoPath: string): Promise<{
    staged: { path: string; changeType: string }[]
    unstaged: { path: string; changeType: string }[]
    unmerged: { path: string; changeType: string }[]
  }> {
    const git = this.getGit(repoPath)
    // Default untracked mode (no -uall): git status is far cheaper on large repos
    // because it collapses untracked directories into a single entry.
    const out = await git.raw(['status', '--porcelain'])
    const staged: { path: string; changeType: string }[] = []
    const unstaged: { path: string; changeType: string }[] = []
    const unmerged: { path: string; changeType: string }[] = []
    const typeOf = (code: string) => code === 'A' ? 'add' : code === 'D' ? 'delete' : 'edit'
    const UNMERGED_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
    for (const line of out.split('\n')) {
      if (!line || line.length < 3) continue
      const x = line[0]
      const y = line[1]
      let path = line.slice(3)
      // renamed/copied: "R  old -> new"
      const arrow = path.indexOf(' -> ')
      if (arrow >= 0) path = path.slice(arrow + 4)
      path = path.replace(/^"|"$/g, '').trim()
      if (!path) continue
      // unmerged (merge conflicts): both columns hold a code and the file is in a
      // conflict state — keep it out of staged/unstaged and report it separately
      if (UNMERGED_CODES.has(x + y)) {
        unmerged.push({ path, changeType: x + y })
        continue
      }
      if (x !== ' ' && x !== '?') staged.push({ path, changeType: typeOf(x) })
      if (y !== ' ' || x === '?') unstaged.push({ path, changeType: x === '?' ? 'add' : typeOf(y || 'M') })
    }
    return { staged, unstaged, unmerged }
  }

  async stage(repoPath: string, files: string[]): Promise<void> {
    const git = this.getGit(repoPath)
    await git.add(files)
  }

  async unstage(repoPath: string, files: string[]): Promise<void> {
    const git = this.getGit(repoPath)
    await git.reset(['--', ...files])
  }

  /**
   * Discards the pending changes of a file, restoring it to HEAD. A staged file
   * is first dropped from the index, an untracked/new file is simply deleted
   * from the working tree, everything else is checked out from the index.
   */
  async discardChanges(
    repoPath: string,
    file: string,
    opts: { staged?: boolean; untracked?: boolean } = {}
  ): Promise<void> {
    const git = this.getGit(repoPath)
    if (opts.staged) {
      await git.reset(['--', file]).catch(() => { /* already unstaged */ })
    }
    if (opts.untracked) {
      await rm(join(repoPath, file), { force: true, recursive: true }).catch(() => { /* gone */ })
      return
    }
    await git.checkout(['--', file])
  }

  async commit(repoPath: string, message: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.commit(message)
  }

  async branches(repoPath: string): Promise<SerializableBranchInfo[]> {
    const b = await this.getGit(repoPath).branch()
    return b.all.map((name) => ({
      name,
      current: name === b.current,
      remote: name.startsWith('remotes/')
    }))
  }

  async log(repoPath: string, count: number): Promise<SerializableCommitInfo[]> {
    const l = await this.getGit(repoPath).log({ maxCount: count })
    return l.all.map((c) => ({
      hash: c.hash,
      date: c.date,
      message: c.message,
      authorName: c.author_name,
      authorEmail: c.author_email
    }))
  }

  async pull(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.pull()
  }

  async push(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.push()
  }

  async fetch(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.fetch()
  }

  async showFile(repoPath: string, filePath: string): Promise<string> {
    const git = this.getGit(repoPath)
    try {
      return await git.show([`HEAD:${filePath}`])
    } catch {
      return ''
    }
  }

  async showRef(repoPath: string, filePath: string, ref: string): Promise<string> {
    const git = this.getGit(repoPath)
    try {
      return await git.show([`${ref}:${filePath}`])
    } catch {
      return ''
    }
  }

  async stageAll(repoPath: string): Promise<void> {
    await this.getGit(repoPath).add(['-A'])
  }

  /**
   * Transfers pending changes from one worktree to another (same repository)
   * via a shared stash: stash on the source, apply on the target, then either
   * drop the stash (move) or restore it onto the source too (copy).
   * With stagedOnly the stash keeps only the staged changes; the unstaged ones
   * stay in the source working tree.
   */
  async transferChanges(
    sourcePath: string,
    targetPath: string,
    opts: { copy: boolean; stagedOnly: boolean }
  ): Promise<{ ok: boolean; message: string }> {
    const source = this.getGit(sourcePath)
    const target = this.getGit(targetPath)
    const pushArgs = ['stash', 'push', '-m', 'damned-ide transfer']
    pushArgs.push(opts.stagedOnly ? '--staged' : '-u')
    try {
      await source.raw(pushArgs)
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
    try {
      await target.raw(['stash', 'apply'])
    } catch (e) {
      // the target apply failed: put the changes back on the source, keep the
      // flow atomic — unless the restore itself fails (stash preserved)
      try {
        await source.raw(['stash', 'apply'])
        await source.raw(['stash', 'drop'])
      } catch { /* stash kept for manual recovery */ }
      return { ok: false, message: (e as Error).message }
    }
    if (opts.copy) {
      try {
        await source.raw(['stash', 'apply'])
      } catch (e) {
        // target already holds the changes; keep the stash for recovery
        return { ok: false, message: `source restore failed: ${(e as Error).message}` }
      }
    }
    await source.raw(['stash', 'drop'])
    return { ok: true, message: 'ok' }
  }

  async pushWithUpstream(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    const current = (await git.branch()).current
    await git.push(['-u', 'origin', current])
  }

  /**
   * Publish an arbitrary local branch (it does not have to be checked out here).
   * Stacked worktrees need the parent on the remote before a PR can target it.
   */
  async pushBranch(repoPath: string, branch: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.push(['origin', branch])
  }

  async merge(repoPath: string, branch: string): Promise<{ ok: boolean; message: string; conflicts: string[] }> {
    const git = this.getGit(repoPath)
    try {
      await git.merge([branch])
      return { ok: true, message: 'merge ok', conflicts: [] }
    } catch (err) {
      const msg = (err as Error).message
      let conflicts: string[] = []
      try {
        const list = await git.raw(['diff', '--name-only', '--diff-filter=U'])
        conflicts = list.split('\n').map(l => l.trim()).filter(Boolean)
      } catch { /* ignore */ }
      return { ok: false, message: msg, conflicts }
    }
  }

  async currentBranch(repoPath: string): Promise<string> {
    return (await this.getGit(repoPath).branch()).current
  }

  /**
   * Absolute path of the common git directory, shared by every worktree of the
   * repository. Used to store per-repository settings (e.g. the run startup
   * project) that must survive across linked worktrees.
   */
  async gitCommonDir(repoPath: string): Promise<string> {
    const out = await this.getGit(repoPath).raw(['rev-parse', '--path-format=absolute', '--git-common-dir'])
    return out.trim()
  }

  /**
   * Repository root that contains `dirPath` (a subfolder of the working tree
   * resolves to the root; a linked worktree resolves to itself). Returns null
   * when the folder is not inside a git repository, so the UI can say so
   * instead of failing later with "not a git repository".
   */
  async resolveRepoRoot(dirPath: string): Promise<string | null> {
    try {
      const out = await this.getGit(dirPath).raw(['rev-parse', '--show-toplevel'])
      return out.trim() || null
    } catch {
      return null
    }
  }

  async blame(repoPath: string, filePath: string): Promise<{ hash: string; author: string; date: string; line: string }[]> {
    const git = this.getGit(repoPath)
    try {
      const out = await git.raw(['blame', '--line-porcelain', filePath])
      const lines: { hash: string; author: string; date: string; line: string }[] = []
      let cur: { hash: string; author: string; date: string; line: string } | null = null
      for (const raw of out.split('\n')) {
        if (/^[0-9a-f]{40}/.test(raw)) {
          if (cur) lines.push(cur)
          cur = { hash: raw.slice(0, 40), author: '', date: '', line: '' }
        } else if (cur && raw.startsWith('author ')) {
          cur.author = raw.slice(7)
        } else if (cur && raw.startsWith('author-time ')) {
          cur.date = new Date(parseInt(raw.slice(12)) * 1000).toISOString().slice(0, 10)
        } else if (cur && raw.startsWith('\t')) {
          cur.line = raw.slice(1)
        }
      }
      if (cur) lines.push(cur)
      return lines
    } catch {
      return []
    }
  }

  async fileLog(repoPath: string, filePath: string, count = 50): Promise<SerializableCommitInfo[]> {
    const git = this.getGit(repoPath)
    try {
      const l = await git.log({ file: filePath, maxCount: count })
      return l.all.map((c) => ({
        hash: c.hash,
        date: c.date,
        message: c.message,
        authorName: c.author_name,
        authorEmail: c.author_email
      }))
    } catch {
      return []
    }
  }

  async diffFile(repoPath: string, filePath: string): Promise<string> {
    const git = this.getGit(repoPath)
    try {
      return await git.diff([filePath])
    } catch {
      return ''
    }
  }
}
