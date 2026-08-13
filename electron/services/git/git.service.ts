import simpleGit, { SimpleGit } from 'simple-git'

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

  async pushWithUpstream(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    const current = (await git.branch()).current
    await git.push(['-u', 'origin', current])
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
