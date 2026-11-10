// Pure rules for the worktree strip/header status (labels, colors, tooltips) and the cleanup
// dialog (which worktrees look useless). No React/electron deps, so it can be
// exercised with plain node (scripts/worktree-cleanup.check.ts).

/** UI text is English; components pass their `t` (useI18n) to get it translated. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string
const en: Translate = (key, vars) => (vars ? key.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : key)

/** The subset of WorktreeOverview (electron worktree.service) these rules read. */
export interface OverviewStatus {
  dirty: boolean | null
  changes: number
  unmerged: boolean | null
  upstreamGone: boolean
  ahead: number
  behind: number
}

/** ADO states that mean "the PBI is over" (Scrum Done/Removed, Agile/CMMI Closed). */
export const PBI_CLOSED_STATES = ['done', 'closed', 'removed']

export const isPbiClosed = (state: string | null | undefined): boolean =>
  !!state && PBI_CLOSED_STATES.includes(state.trim().toLowerCase())

/** PBI id from the branch convention `feature/<id>` or `bugfix/<id>-text` (NewWorktreeDialog);
 *  other branches (release/2024.11, hotfix/1.2.3) have none. */
export function pbiIdFromBranch(branch: string): number | null {
  const m = /(?:^|\/)(?:feature|bugfix)\/(\d+)/i.exec(branch)
  return m ? Number(m[1]) : null
}

/** Last segment of the branch (develop/main/master kept whole). */
export function shortBranch(branch: string): string {
  if (!branch) return ''
  if (branch === 'main' || branch === 'master' || branch === 'develop') return branch
  const parts = branch.split('/')
  return parts[parts.length - 1] || branch
}

/** Badge label in the worktree strip: 'main', the full PBI id (from the folder, else the branch),
 *  or the first 5 chars of the branch. */
export function stripLabel(branch: string, isMain: boolean, folderId: number | null = null): string {
  if (isMain) return 'main'
  const id = folderId ?? pbiIdFromBranch(branch)
  return id !== null ? String(id) : shortBranch(branch.replace(/^refs\/heads\//, '')).slice(0, 5)
}

/** Where the worktrees live and which subfolders hold PBIs and bugs (Settings › Git › worktree). */
export interface WorktreeLayout {
  /** relative to the repository (`.worktrees`; `.` = next to the sources) or absolute */
  root: string
  /** subfolder of root for PBIs; '' = straight in root */
  pbiFolder: string
  /** subfolder of root for bugs; '' = straight in root */
  bugFolder: string
}

export const DEFAULT_WORKTREE_LAYOUT: WorktreeLayout = { root: '.worktrees', pbiFolder: 'feature', bugFolder: 'bugfix' }

/** `C:\x`, `/x`, `\\server`, and a bare drive `D:` (a drive root once its separator is trimmed);
 *  `D:x` (relative to that drive's current folder) is not. */
export const isAbsolutePath = (p: string): boolean => /^(?:[a-z]:(?:[\\/]|$)|[\\/])/i.test(p.trim())

/** Comparable form of a path: '/' separators, `.`/`..` resolved, lowercase.
 *  ponytail: lowercase also on Linux, where two folders differing only in case would match */
const pathKey = (p: string): string => {
  const out: string[] = []
  p.replace(/\\/g, '/').toLowerCase().split('/').forEach((s, i) => {
    if (s === '..') out.pop()
    else if (s !== '.' && (s !== '' || i === 0)) out.push(s)
  })
  return out.join('/')
}

/** PBI or bug read from the folder: `<root>/<pbiFolder>/<name>` or `<root>/<bugFolder>/<name>`
 *  (root relative to `basePath`, the main checkout, unless absolute); `id` = the folder name when
 *  it is a number. null outside those folders, or when both are '' or the same folder (the
 *  folder cannot tell them apart: the branch decides). */
export function folderKind(path: string, basePath: string, layout: WorktreeLayout): { kind: 'pbi' | 'bug'; id: number | null } | null {
  const subOf = (folder: string) => pathKey(folder.trim()).replace(/^\/+|\/+$/g, '')
  const pbi = subOf(layout.pbiFolder)
  const bug = subOf(layout.bugFolder)
  if (pbi === bug) return null
  const root = pathKey(isAbsolutePath(layout.root) ? layout.root : `${basePath}/${layout.root.trim() || '.'}`)
  const p = pathKey(path)
  if (!p.startsWith(`${root}/`)) return null
  const rest = p.slice(root.length + 1).split('/')
  const name = rest[rest.length - 1]
  const sub = rest.slice(0, -1).join('/')
  const kind = sub === bug ? 'bug' : sub === pbi ? 'pbi' : null
  return kind ? { kind, id: /^\d+$/.test(name) ? Number(name) : null } : null
}

/** The main checkout: `git worktree list` always lists it first (a bare repository has none). */
export const mainWorktreePath = (list: { path: string; bare: boolean }[]): string | null =>
  list[0] && !list[0].bare ? list[0].path : null

/** `done` plus the stacked children re-targeted on develop with it (none: `done` alone). */
export function withChildren(done: string, n: number, t: Translate = en): string {
  if (n <= 0) return done
  return n === 1 ? t('{done} (1 child moved back to develop)', { done }) : t('{done} ({n} children moved back to develop)', { done, n })
}

/** Kind of a worktree: the logo blurred inside its strip badge and the ring color. */
export type StripKind = 'main' | 'pbi' | 'bug' | 'branch' | 'detached'

/** Ring and logo color of each kind (the selected badge rings in the accent color instead). */
export const KIND_COLORS: Record<StripKind, string> = {
  main: 'var(--text-secondary)',
  pbi: 'var(--accent-secondary)',
  bug: 'var(--warning-color)',
  branch: 'var(--text-muted)',
  detached: 'var(--text-muted)'
}

export interface StripBadge {
  kind: StripKind
  /** uncommitted count for the red bubble; null when clean or unknown */
  dirty: string | null
  /** PBI closed, nothing uncommitted and nothing to push: dimmed with a check. Commits on no
   *  remote at all are not visible here (overview without localOnly): the cleanup checks them */
  done: boolean
  ahead: number
  behind: number
}

/** What a strip badge shows around its label. `folder` = the kind its folder tells (folderKind),
 *  which wins over the branch name. */
export function stripBadge(
  branch: string,
  isMain: boolean,
  ov: Pick<OverviewStatus, 'dirty' | 'changes' | 'ahead' | 'behind'> | null | undefined,
  pbiState?: string | null,
  folder?: 'pbi' | 'bug' | null
): StripBadge {
  const kind: StripKind = isMain ? 'main'
    : folder ? folder
    : !branch ? 'detached'
      : branch.includes('bugfix') ? 'bug'
        : /(?:^|\/)feature\//i.test(branch) ? 'pbi'
          : 'branch'
  const dirty = ov?.dirty ? (ov.changes > 99 ? '99+' : String(ov.changes || '!')) : null
  return {
    kind,
    dirty,
    done: !isMain && isPbiClosed(pbiState) && ov?.dirty === false && ov.ahead === 0,
    ahead: ov?.ahead ?? 0,
    behind: ov?.behind ?? 0
  }
}

/** Stack state chip of a stacked worktree (label, color, tooltip); English, translated at render. */
export const STACK_LABELS: Record<WorktreeParentState, { label: string; color: string; tip: string }> = {
  open: { label: 'stacked', color: 'var(--accent-color)', tip: 'the parent is not in develop yet' },
  merged: { label: 'parent in develop', color: 'var(--warning-color)', tip: 'the parent is already in develop: promote on develop' },
  absorbed: { label: 'absorbed', color: 'var(--success-color)', tip: 'the work is already inside the parent: the worktree can be removed' },
  abandoned: { label: 'parent missing', color: 'var(--error-color)', tip: 'the parent branch no longer exists' },
  rewritten: { label: 'base rewritten', color: 'var(--warning-color)', tip: "the parent's history was rewritten (force-push)" },
  unknown: { label: 'to verify', color: 'var(--text-muted)', tip: 'state cannot be determined' }
}

export type WorktreeTone = 'dirty' | 'unmerged' | 'clean'

/** dirty wins over unmerged; null while the state is unknown. */
export function worktreeTone(ov: Pick<OverviewStatus, 'dirty' | 'unmerged'> | null | undefined): WorktreeTone | null {
  if (!ov) return null
  if (ov.dirty) return 'dirty'
  if (ov.unmerged) return 'unmerged'
  if (ov.dirty === false && ov.unmerged === false) return 'clean'
  return null
}

/** Text color of a tone; null keeps the default color (clean or unknown). */
export function toneColor(tone: WorktreeTone | null): string | null {
  if (tone === 'dirty') return 'var(--error-color)'
  if (tone === 'unmerged') return 'var(--info-color)'
  return null
}

/** One-line status for tooltips: "3 uncommitted changes · commits not in develop · ↑1 ↓2". */
export function overviewSummary(ov: OverviewStatus | null | undefined, t: Translate = en): string {
  if (!ov) return ''
  const parts: string[] = []
  if (ov.dirty) parts.push(ov.changes === 1 ? t('1 uncommitted change') : t('{n} uncommitted changes', { n: ov.changes }))
  if (ov.unmerged) parts.push(t('commits not in develop'))
  if (ov.upstreamGone) parts.push(t('no remote branch'))
  const sync = [ov.ahead > 0 ? `↑${ov.ahead}` : '', ov.behind > 0 ? `↓${ov.behind}` : ''].filter(Boolean).join(' ')
  if (sync) parts.push(t('{sync} (as of the last fetch)', { sync }))
  return parts.join(' · ')
}

export type CleanupVerdict = 'remove' | 'maybe' | 'keep'

export interface CleanupInput {
  isMain: boolean
  /** '' for a detached HEAD */
  branch: string
  dirty: boolean | null
  /** commits on no remote; undefined when unknown */
  localOnly?: number
  /** ADO state: undefined = no ADO or no id in the branch, null = id not found */
  pbiState?: string | null
  /** stack state of the branch (WorktreeParentState), when stacked */
  stackState?: string
  upstream?: string | null
  upstreamGone: boolean
  unmerged: boolean | null
}

export interface CleanupResult {
  verdict: CleanupVerdict
  /** a safety rule failed: the row cannot be selected */
  locked: boolean
  reasons: string[]
}

/**
 * Safety first (never the main checkout, a detached HEAD, uncommitted or
 * unknown changes, commits on no remote), then:
 * - remove: PBI Done/Closed/Removed, or the branch is absorbed by its parent
 *   (unless its PBI is known to be still open: New/Active/... is kept);
 * - maybe: PBI unknown, already in develop and its remote branch gone (the
 *   usual completed PR). Not pre-selected: a never-pushed, untouched branch
 *   looks the same to git;
 * - keep: everything else, with the reason.
 */
export function classifyCleanup(i: CleanupInput, t: Translate = en): CleanupResult {
  const locked = (reason: string): CleanupResult => ({ verdict: 'keep', locked: true, reasons: [reason] })
  if (i.isMain) return locked(t('main checkout'))
  if (!i.branch) return locked(t('detached HEAD'))
  if (i.dirty === null) return locked(t('git status unreadable'))
  if (i.dirty) return locked(t('uncommitted changes'))
  if (i.localOnly === undefined) return locked(t('local commits not verifiable'))
  if (i.localOnly > 0) return locked(i.localOnly === 1 ? t('1 unpushed commit') : t('{n} unpushed commits', { n: i.localOnly }))

  const reasons: string[] = []
  const state = typeof i.pbiState === 'string' ? i.pbiState.trim() : ''
  const closed = isPbiClosed(state)
  // an absorbed branch whose PBI is still open (New, Active...) is someone's live work
  const absorbed = i.stackState === 'absorbed' && (!state || closed)
  if (closed || absorbed) {
    if (closed) reasons.push(`PBI ${state}`)
    if (absorbed) reasons.push(t('work already in the parent branch'))
    if (i.unmerged) reasons.push(t('commits not in develop (pushed)'))
    return { verdict: 'remove', locked: false, reasons }
  }
  if (!state && i.unmerged === false && i.upstreamGone) {
    reasons.push(i.pbiState === null ? t('PBI not found') : t('PBI not verified'))
    // ponytail: git cannot tell "never pushed" from "deleted after the PR": both are 'gone'
    reasons.push(t('already in develop, no remote branch (removed after the PR or never published)'))
    return { verdict: 'maybe', locked: false, reasons }
  }
  if (state) reasons.push(`PBI ${state}`)
  else if (i.unmerged) reasons.push(t('commits not in develop'))
  else if (i.unmerged === null) reasons.push(t('develop not found'))
  else if (!i.upstreamGone && i.upstream) reasons.push(t('{upstream} still there', { upstream: i.upstream }))
  else reasons.push(t('no upstream'))
  return { verdict: 'keep', locked: false, reasons }
}
