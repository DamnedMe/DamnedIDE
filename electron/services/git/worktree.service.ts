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

export async function revParseCommit(git: SimpleGit, ref: string): Promise<string | null> {
  try {
    const out = (await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim()
    return out || null
  } catch {
    return null
  }
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

async function countCommits(git: SimpleGit, range: string): Promise<number> {
  try {
    return Number((await git.raw(['rev-list', '--count', range])).trim()) || 0
  } catch {
    return 0
  }
}

/** Prefers the remote-tracking ref, then the local branch. */
async function resolveRef(git: SimpleGit, name: string): Promise<string | null> {
  if (await revParseCommit(git, `refs/remotes/origin/${name}`)) return `origin/${name}`
  if (await revParseCommit(git, name)) return name
  return null
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
export async function parentStatus(git: SimpleGit, branch: string, link: StackLink): Promise<WorktreeStackInfo> {
  const info: WorktreeStackInfo = {
    branch, parent: link.parent, tip: link.tip, state: 'open', behindParent: 0, aheadParent: 0, mergeRef: 'origin/develop'
  }
  const headRef = await revParseCommit(git, branch)
  const parentRef = await resolveRef(git, link.parent)
  const developRef = await resolveRef(git, 'develop')
  // the parent worktree commits on the local branch and pushes only on completion,
  // so the local ref can be ahead of the remote one: both are signals
  const localParent = await revParseCommit(git, link.parent)

  if (!parentRef) {
    return { ...info, state: 'abandoned', detail: `branch '${link.parent}' non trovato (cancellato dopo il merge?)` }
  }
  info.mergeRef = parentRef

  // a child with no commits of its own sits on the recorded base tip: it is not
  // "absorbed", it is simply empty (absorbed = its own work already in the parent)
  const childAdvanced = !link.tip || headRef !== link.tip
  const absorbed = !!headRef && childAdvanced && (
    await isAncestor(git, headRef, parentRef) ||
    (!!localParent && await isAncestor(git, headRef, link.parent))
  )
  if (absorbed) {
    return { ...info, state: 'absorbed', detail: `il lavoro di ${branch} è già dentro ${link.parent}` }
  }

  // a parent with no commits of its own sits exactly on develop: keep it stacked
  // (targeting it is the same as targeting develop), otherwise a fresh stack
  // would immediately look "merged"
  const parentTip = localParent || await revParseCommit(git, parentRef)
  const parentEmpty = !!developRef && !!parentTip && parentTip === await revParseCommit(git, developRef)
  // "in develop" requires both refs: an unpushed parent commit keeps it stacked
  const parentInDevelop = !!developRef &&
    await isAncestor(git, parentRef, developRef) &&
    (!localParent || await isAncestor(git, link.parent, developRef))
  if (!parentEmpty && parentInDevelop) {
    return {
      ...info,
      state: 'merged',
      detail: `${link.parent} è già in develop`,
      mergeRef: developRef,
      behindParent: await countCommits(git, `${branch}..${parentRef}`)
    }
  }
  if (link.tip) {
    const recorded = await revParseCommit(git, link.tip)
    if (recorded && !(await isAncestor(git, link.tip, parentRef))) {
      return {
        ...info,
        state: 'rewritten',
        detail: `la base ${link.parent} è stata riscritta (force-push)`,
        behindParent: await countCommits(git, `${branch}..${parentRef}`)
      }
    }
  }
  return {
    ...info,
    state: 'open',
    detail: `${link.parent} non è ancora in develop`,
    behindParent: await countCommits(git, `${branch}..${parentRef}`),
    aheadParent: await countCommits(git, `${parentRef}..${branch}`)
  }
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
    const out: WorktreeStackInfo[] = []
    for (const entry of entries) {
      const branch = entry.branch.replace(/^refs\/heads\//, '')
      if (!branch) continue
      const link = await readStackLink(git, branch)
      if (!link) continue
      out.push(await parentStatus(git, branch, link))
    }
    return out
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

  async prune(repoPath: string): Promise<void> {
    const git = this.getGit(repoPath)
    await git.raw(['worktree', 'prune'])
  }
}
