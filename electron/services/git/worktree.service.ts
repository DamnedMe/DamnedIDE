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
  /** removeSafe only: refused by a safety check, nothing was touched */
  skipped?: boolean
}

/** Per-worktree status for the list (colors, ahead/behind) and the cleanup dialog. */
export interface WorktreeOverview {
  path: string
  branch: string
  /** uncommitted changes, untracked files included; null when the folder is missing or unreadable */
  dirty: boolean | null
  changes: number
  /** upstream short name (origin/feature/x); null when none is configured */
  upstream: string | null
  /** upstream configured but its remote-tracking ref is missing: never pushed, or deleted after the merge */
  upstreamGone: boolean
  /** commits to push / to pull, relative to the last fetch */
  ahead: number
  behind: number
  /** the branch has commits not in develop; null when develop cannot be resolved */
  unmerged: boolean | null
  /** the develop ref `unmerged` is computed against (origin/develop preferred) */
  base: string | null
  /** commits on no remote branch (only with `localOnly`): 0 means nothing would be lost */
  localOnly?: number
}

/** Parses `%(upstream:track,nobracket)`: '', 'gone', 'ahead 1', 'behind 2', 'ahead 1, behind 2'. */
export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  const t = (track || '').trim()
  return {
    ahead: Number(/ahead (\d+)/.exec(t)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(t)?.[1] ?? 0),
    gone: t === 'gone'
  }
}

/** Runs `fn` over `items` with at most `size` calls in flight (each one spawns git processes). */
async function inPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

/** Lines of `git status --porcelain` in a worktree; null when it is not a readable worktree. */
async function changeCount(worktreePath: string, ignoreDeletions = false): Promise<number | null> {
  // without its `.git` file, git would walk up and report the main repository instead
  if (!existsSync(join(worktreePath, '.git'))) return null
  try {
    // background refresh: never take index.lock away from the user's own git commands
    const out = await simpleGit(worktreePath).raw(['--no-optional-locks', 'status', '--porcelain'])
    // the main checkout always sees the IDE's own `.worktrees/` folder as untracked;
    // deleted tracked files (a half-done rm) are still in git, so they lose nothing
    return out.split('\n').filter(l => l.trim() && l.trim() !== '?? .worktrees/' && !(ignoreDeletions && /^(?: D|D |DD)/.test(l))).length
  } catch {
    return null
  }
}

/** Commits of a branch that no remote-tracking ref contains; undefined when unknown. */
async function localOnlyCount(git: SimpleGit, branch: string): Promise<number | undefined> {
  try {
    const out = (await git.raw(['rev-list', '--count', `refs/heads/${branch}`, '--not', '--remotes'])).trim()
    return /^\d+$/.test(out) ? Number(out) : undefined
  } catch {
    return undefined
  }
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

// ─── Stacked worktrees (a branch created from another branch) ────────────────
// The link lives in the repository config (`branch.<name>.damnedide-base`): it is
// inspectable with plain git and survives app reinstalls, but it is local to the
// clone — the shared truth for the team remains the PR base branch.

export interface StackLink {
  parent: string
  /** tip of the parent when the link was created (detects a rewritten base) */
  tip?: string
}

export type ParentState =
  | 'open' // parent exists and is not in develop yet
  | 'merged' // parent already merged into develop
  | 'absorbed' // this branch is already contained in the parent
  | 'abandoned' // parent branch gone (merged+deleted, or abandoned)
  | 'rewritten' // parent history rewritten (force-push)
  | 'unknown'

export interface WorktreeStackInfo {
  branch: string
  parent: string
  tip?: string
  state: ParentState
  detail?: string
  /** commits the parent has and this branch does not (base avanzata) */
  behindParent: number
  /** commits this branch has and the parent does not */
  aheadParent: number
  /** ref to merge to align this branch (the parent when open, develop otherwise) */
  mergeRef: string
}

const BASE_KEY = 'damnedide-base'
const TIP_KEY = 'damnedide-base-tip'

/**
 * Per-call memo for the many `git` commands `parentStatus` runs per branch:
 * a repository refresh must not respawn the same rev-parse/merge-base for every
 * stacked worktree.
 */
export interface StackCache {
  commits: Map<string, string | null>
  ancestors: Map<string, boolean>
  refs: Map<string, string | null>
  counts: Map<string, number>
}

export function newStackCache(): StackCache {
  return { commits: new Map(), ancestors: new Map(), refs: new Map(), counts: new Map() }
}

export async function revParseCommit(git: SimpleGit, ref: string): Promise<string | null> {
  try {
    const out = (await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim()
    return out || null
  } catch {
    return null
  }
}

async function revParseCommitCached(git: SimpleGit, ref: string, cache: StackCache): Promise<string | null> {
  const hit = cache.commits.get(ref)
  if (hit !== undefined) return hit
  const value = await revParseCommit(git, ref)
  cache.commits.set(ref, value)
  return value
}

/**
 * True when `ancestor` is reachable from `descendant`.
 * Compares the merge-base with `ancestor` instead of using `merge-base --is-ancestor`:
 * simple-git's raw() resolves even when that command exits with 1 (no stderr), which
 * would make every check look positive.
 */
async function isAncestor(git: SimpleGit, ancestor: string, descendant: string): Promise<boolean> {
  try {
    const base = (await git.raw(['merge-base', ancestor, descendant])).trim()
    const head = await revParseCommit(git, ancestor)
    return !!base && !!head && base === head
  } catch {
    return false
  }
}

async function isAncestorCached(git: SimpleGit, ancestor: string, descendant: string, cache: StackCache): Promise<boolean> {
  const key = `${ancestor}\u0000${descendant}`
  const hit = cache.ancestors.get(key)
  if (hit !== undefined) return hit
  let value = false
  try {
    const base = (await git.raw(['merge-base', ancestor, descendant])).trim()
    const head = await revParseCommitCached(git, ancestor, cache)
    value = !!base && !!head && base === head
  } catch {
    value = false
  }
  cache.ancestors.set(key, value)
  return value
}

async function countCommits(git: SimpleGit, range: string): Promise<number> {
  try {
    return Number((await git.raw(['rev-list', '--count', range])).trim()) || 0
  } catch {
    return 0
  }
}

async function countCommitsCached(git: SimpleGit, range: string, cache: StackCache): Promise<number> {
  const hit = cache.counts.get(range)
  if (hit !== undefined) return hit
  const value = await countCommits(git, range)
  cache.counts.set(range, value)
  return value
}

/** Prefers the remote-tracking ref, then the local branch. */
async function resolveRef(git: SimpleGit, name: string): Promise<string | null> {
  if (await revParseCommit(git, `refs/remotes/origin/${name}`)) return `origin/${name}`
  if (await revParseCommit(git, name)) return name
  return null
}

async function resolveRefCached(git: SimpleGit, name: string, cache: StackCache): Promise<string | null> {
  const hit = cache.refs.get(name)
  if (hit !== undefined) return hit
  const value = await resolveRef(git, name)
  cache.refs.set(name, value)
  return value
}

export async function readStackLink(git: SimpleGit, branch: string): Promise<StackLink | null> {
  if (!branch) return null
  try {
    const parent = (await git.raw(['config', '--get', `branch.${branch}.${BASE_KEY}`])).trim()
    if (!parent) return null
    let tip: string | undefined
    try {
      tip = (await git.raw(['config', '--get', `branch.${branch}.${TIP_KEY}`])).trim() || undefined
    } catch { /* optional */ }
    return { parent, tip }
  } catch {
    return null
  }
}

export async function writeStackLink(git: SimpleGit, branch: string, parent: string, tip?: string): Promise<void> {
  await git.raw(['config', `branch.${branch}.${BASE_KEY}`, parent])
  if (tip) await git.raw(['config', `branch.${branch}.${TIP_KEY}`, tip])
}

export async function clearStackLink(git: SimpleGit, branch: string): Promise<void> {
  await git.raw(['config', '--unset', `branch.${branch}.${BASE_KEY}`]).catch(() => { /* already absent */ })
  await git.raw(['config', '--unset', `branch.${branch}.${TIP_KEY}`]).catch(() => { /* already absent */ })
}

/**
 * Classifies the parent of a stacked branch with local signals only (an ADO
 * check could refine the squash-merge case, which `merge-base` cannot see).
 */
export async function parentStatus(git: SimpleGit, branch: string, link: StackLink, cache: StackCache = newStackCache()): Promise<WorktreeStackInfo> {
  const info: WorktreeStackInfo = {
    branch, parent: link.parent, tip: link.tip, state: 'open', behindParent: 0, aheadParent: 0, mergeRef: 'origin/develop'
  }
  const headRef = await revParseCommitCached(git, branch, cache)
  const parentRef = await resolveRefCached(git, link.parent, cache)
  const developRef = await resolveRefCached(git, 'develop', cache)
  // the parent worktree commits on the local branch and pushes only on completion,
  // so the local ref can be ahead of the remote one: both are signals
  const localParent = await revParseCommitCached(git, link.parent, cache)

  if (!parentRef) {
    return { ...info, state: 'abandoned', detail: `branch '${link.parent}' non trovato (cancellato dopo il merge?)` }
  }
  info.mergeRef = parentRef

  // a child with no commits of its own sits on the recorded base tip: it is not
  // "absorbed", it is simply empty (absorbed = its own work already in the parent)
  const childAdvanced = !link.tip || headRef !== link.tip
  const absorbed = !!headRef && childAdvanced && (
    await isAncestorCached(git, headRef, parentRef, cache) ||
    (!!localParent && await isAncestorCached(git, headRef, link.parent, cache))
  )
  if (absorbed) {
    return { ...info, state: 'absorbed', detail: `il lavoro di ${branch} è già dentro ${link.parent}` }
  }

  // a parent with no commits of its own sits exactly on develop: keep it stacked
  // (targeting it is the same as targeting develop), otherwise a fresh stack
  // would immediately look "merged"
  const parentTip = localParent || await revParseCommitCached(git, parentRef, cache)
  const parentEmpty = !!developRef && !!parentTip && parentTip === await revParseCommitCached(git, developRef, cache)
  // "in develop" requires both refs: an unpushed parent commit keeps it stacked
  const parentInDevelop = !!developRef &&
    await isAncestorCached(git, parentRef, developRef, cache) &&
    (!localParent || await isAncestorCached(git, link.parent, developRef, cache))
  if (!parentEmpty && parentInDevelop) {
    return {
      ...info,
      state: 'merged',
      detail: `${link.parent} è già in develop`,
      mergeRef: developRef,
      behindParent: await countCommitsCached(git, `${branch}..${parentRef}`, cache)
    }
  }
  if (link.tip) {
    const recorded = await revParseCommitCached(git, link.tip, cache)
    if (recorded && !(await isAncestorCached(git, link.tip, parentRef, cache))) {
      return {
        ...info,
        state: 'rewritten',
        detail: `la base ${link.parent} è stata riscritta (force-push)`,
        behindParent: await countCommitsCached(git, `${branch}..${parentRef}`, cache)
      }
    }
  }
  return {
    ...info,
    state: 'open',
    detail: `${link.parent} non è ancora in develop`,
    behindParent: await countCommitsCached(git, `${branch}..${parentRef}`, cache),
    aheadParent: await countCommitsCached(git, `${parentRef}..${branch}`, cache)
  }
}

/**
 * Reads every stack link of the repository with two `git config` calls instead
 * of two per branch: the branch list refresh used to spawn a process per branch.
 */
async function readStackLinks(git: SimpleGit): Promise<Map<string, StackLink>> {
  const links = new Map<string, StackLink>()
  let baseOut = ''
  try {
    baseOut = await git.raw(['config', '--get-regexp', `^branch\\..*\\.${BASE_KEY}$`])
  } catch {
    return links
  }
  const tips = new Map<string, string>()
  try {
    const tipOut = await git.raw(['config', '--get-regexp', `^branch\\..*\\.${TIP_KEY}$`])
    for (const line of tipOut.split('\n')) {
      const m = /^branch\.(.+)\.damnedide-base-tip\s+(.+)$/.exec(line.trim())
      if (m) tips.set(m[1], m[2].trim())
    }
  } catch { /* optional */ }
  for (const line of baseOut.split('\n')) {
    const m = /^branch\.(.+)\.damnedide-base\s+(.+)$/.exec(line.trim())
    if (!m) continue
    links.set(m[1], { parent: m[2].trim(), tip: tips.get(m[1]) })
  }
  return links
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
        current.branch = line.slice(18)
      } else if (line.startsWith('bare')) {
        current.bare = true
      } else if (line.startsWith('detached')) {
        current.detached = true
      }
    }

    if (current.path) entries.push(current as WorktreeEntry)
    return entries
  }

  async add(repoPath: string, branch: string, worktreePath: string, base = 'origin/develop'): Promise<void> {
    const git = this.getGit(repoPath)
    // fail fast with an actionable message instead of git's bare
    // "fatal: not a git repository (or any of the parent directories): .git"
    try {
      await git.raw(['rev-parse', '--git-dir'])
    } catch {
      throw new Error(`"${repoPath}" non è un repository git: apri la cartella che contiene la directory .git`)
    }

    // a branch can be checked out in a single worktree
    const existing = await this.list(repoPath).catch(() => [] as WorktreeEntry[])
    const taken = existing.find(e => e.branch.replace(/^refs\/heads\//, '') === branch)
    if (taken) {
      throw new Error(`il branch '${branch}' è già usato dal worktree "${taken.path}": scegli un altro nome o lavora lì`)
    }

    // `git worktree add` creates the leaf directory but not the missing parents
    await mkdir(dirname(worktreePath), { recursive: true }).catch(() => { /* created by git */ })

    // Fetch the base branch (no tags — faster) so the new branch starts from the
    // latest. If the fetch fails (offline), fall back to the local refs.
    const baseName = base.replace(/^origin\//, '')
    try {
      await git.fetch(['--no-tags', 'origin', baseName])
    } catch { /* offline: proceed with the local ref */ }

    // start point: the requested base (preferring the remote-tracking ref) then
    // its local counterpart, then develop for the default base
    const candidates = base.startsWith('origin/')
      ? [base, baseName]
      : [`origin/${baseName}`, baseName]
    let startPoint: string | null = null
    for (const candidate of candidates) {
      if (await revParseCommit(git, candidate)) { startPoint = candidate; break }
    }
    if (!startPoint) {
      throw new Error(baseName === 'develop'
        ? `il repository non ha un branch 'develop' (né origin/develop): fai un fetch o crea il branch prima di creare un worktree`
        : `base '${base}' non trovata: fai un fetch o scegli un altro branch`)
    }

    await git.raw(['worktree', 'add', '-b', branch, worktreePath, startPoint])
    // `git worktree add -b <branch> ... origin/develop` auto-tracks the start
    // point, so the new branch would track origin/develop. Point the upstream at
    // the matching remote branch (origin/feature/x or origin/bugfix/x) instead,
    // so status/push/pull operate on the branch's own remote counterpart even
    // before it has been pushed (push then creates it).
    await git.raw(['config', `branch.${branch}.remote`, 'origin'])
    await git.raw(['config', `branch.${branch}.merge`, `refs/heads/${branch}`])

    // remember the stack link (a develop base is the default: no link needed)
    if (baseName !== 'develop') {
      const tip = await revParseCommit(git, startPoint)
      await writeStackLink(git, branch, baseName, tip || undefined)
    }
  }

  /** Stack info for every linked worktree branch of the repository. */
  async stack(repoPath: string): Promise<WorktreeStackInfo[]> {
    const git = this.getGit(repoPath)
    const entries = await this.list(repoPath)
    const links = await readStackLinks(git)
    const targets: Array<{ branch: string; link: StackLink }> = []
    for (const entry of entries) {
      const branch = entry.branch.replace(/^refs\/heads\//, '')
      if (!branch) continue
      const link = links.get(branch)
      if (!link) continue
      targets.push({ branch, link })
    }
    // Each classification runs several `git` processes: memoise the shared refs
    // (develop, parents) and run a few branches in parallel instead of one at a
    // time — with many stacked worktrees this was the slowest panel refresh.
    const cache = newStackCache()
    const results = new Map<string, WorktreeStackInfo>()
    await inPool(targets, 4, async target => {
      results.set(target.branch, await parentStatus(git, target.branch, target.link, cache))
    })
    return targets.map(target => results.get(target.branch)!).filter(Boolean)
  }

  /**
   * Status of every worktree in a few processes: one for-each-ref for upstream
   * and ahead/behind (restricted to the worktree branches), one for the
   * branches with commits not in develop, then `status --porcelain` per
   * worktree in the pool. No network: counts are as fresh as the last fetch.
   * `paths` limits the result to those worktrees; `localOnly` adds the count of
   * commits on no remote (cleanup dialog only).
   */
  async overview(repoPath: string, opts: { paths?: string[]; localOnly?: boolean } = {}): Promise<WorktreeOverview[]> {
    const git = this.getGit(repoPath)
    const wanted = opts.paths ? new Set(opts.paths.map(normalizeForCompare)) : null
    const entries = (await this.list(repoPath))
      .filter(e => !e.bare && (!wanted || wanted.has(normalizeForCompare(e.path))))
    const branchOf = (e: WorktreeEntry) => e.branch.replace(/^refs\/heads\//, '')
    const refs = [...new Set(entries.map(branchOf).filter(Boolean))].map(b => `refs/heads/${b}`)
    const names = (out: string) => out.split('\n').map(l => l.trim())
      .filter(l => l.startsWith('refs/heads/')).map(l => l.slice('refs/heads/'.length))
    const results: WorktreeOverview[] = entries.map(e => ({
      path: e.path, branch: branchOf(e), dirty: null, changes: 0,
      upstream: null, upstreamGone: false, ahead: 0, behind: 0, unmerged: null, base: null
    }))
    // the ref queries and the per-worktree status run side by side: process
    // spawns dominate on Windows, so waiting on each in turn doubles the time
    // ponytail: every worktree ref goes on one command line; Windows caps it at
    // 32K chars (~500 worktrees), chunk the refs if that ever becomes real
    const [track, { base, unmerged }] = await Promise.all([
      (async () => {
        const map = new Map<string, { upstream: string | null; ahead: number; behind: number; gone: boolean }>()
        if (refs.length === 0) return map
        const out = await git.raw(['for-each-ref', '--format=%(refname)%00%(upstream:short)%00%(upstream:track,nobracket)', ...refs]).catch(() => '')
        for (const line of out.split('\n')) {
          const [ref, upstream, tr] = line.split('\0')
          if (!ref?.startsWith('refs/heads/')) continue
          map.set(ref.slice('refs/heads/'.length), { upstream: upstream || null, ...parseTrack(tr || '') })
        }
        return map
      })(),
      (async () => {
        const base = await resolveRef(git, 'develop')
        if (!base || refs.length === 0) return { base, unmerged: null }
        try {
          return { base, unmerged: new Set(names(await git.raw(['for-each-ref', `--no-merged=${base}`, '--format=%(refname)', ...refs]))) }
        } catch {
          return { base, unmerged: null }
        }
      })(),
      inPool(results, 4, async ov => {
        const changes = await changeCount(ov.path)
        ov.dirty = changes === null ? null : changes > 0
        ov.changes = changes ?? 0
        if (opts.localOnly && ov.branch) ov.localOnly = await localOnlyCount(git, ov.branch)
      })
    ])
    for (const ov of results) {
      const t = ov.branch ? track.get(ov.branch) : undefined
      ov.upstream = t?.upstream ?? null
      ov.upstreamGone = !!t?.gone
      ov.ahead = t?.ahead ?? 0
      ov.behind = t?.behind ?? 0
      ov.unmerged = ov.branch && unmerged ? unmerged.has(ov.branch) : null
      ov.base = base
    }
    return results
  }

  /** Drops the stack link of a branch (after a promotion to develop). */
  async clearLink(repoPath: string, branch: string): Promise<void> {
    await clearStackLink(this.getGit(repoPath), branch)
  }

  /** Drops the link of every branch stacked on `parentBranch`; returns them. */
  async retargetChildren(repoPath: string, parentBranch: string): Promise<string[]> {
    const git = this.getGit(repoPath)
    const affected: string[] = []
    for (const info of await this.stack(repoPath)) {
      if (info.parent === parentBranch) {
        await clearStackLink(git, info.branch)
        affected.push(info.branch)
      }
    }
    return affected
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

  /**
   * Removal for the bulk cleanup: right before deleting it re-checks that
   * nothing would be lost (clean working tree, every commit on a remote) and
   * refuses the main checkout and detached worktrees. A refusal touches nothing
   * and returns `skipped`. Ignored files (bin/obj, local config) are deleted,
   * like in remove(); the local branch is kept.
   * `forceTeardown` = forced retry after a locked folder: the same checks run
   * again (deleted tracked files from the half-done rm do not count), then it
   * runs the teardown (close terminals) and removes with force.
   */
  async removeSafe(repoPath: string, worktreePath: string, forceTeardown?: () => void): Promise<RemoveResult> {
    const skip = (error: string): RemoveResult => ({ ok: false, skipped: true, error })
    const target = normalizeForCompare(worktreePath)
    const entries = await this.list(repoPath)
    if (target === normalizeForCompare(repoPath) || (entries[0] && target === normalizeForCompare(entries[0].path))) {
      return skip('checkout principale: non rimosso')
    }
    const entry = entries.find(e => normalizeForCompare(e.path) === target)
    if (!entry) return skip('non è un worktree di questo repository')
    if (!entry.path.includes('.worktrees')) return skip('worktree fuori da .worktrees: non rimosso')
    const branch = entry.branch.replace(/^refs\/heads\//, '')
    if (!branch) return skip('HEAD detached: non rimosso')
    const force = !!forceTeardown
    const changes = await changeCount(entry.path, force)
    // ponytail: a forced retry whose half-done rm already took `.git` cannot re-read the
    // status; the non-forced pass just before had verified it clean, so it proceeds
    if (changes === null && !force) return skip('stato git non leggibile: non rimosso')
    if (changes !== null && changes > 0) return skip(`${changes} modifiche non committate: non rimosso`)
    const localOnly = await localOnlyCount(this.getGit(repoPath), branch)
    if (localOnly === undefined) return skip('commit locali non verificabili: non rimosso')
    if (localOnly > 0) return skip(`${localOnly} commit non pushati: non rimosso`)
    forceTeardown?.()
    return this.remove(repoPath, worktreePath, force)
  }

  async prune(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.raw(['worktree', 'prune'])
  }
}
