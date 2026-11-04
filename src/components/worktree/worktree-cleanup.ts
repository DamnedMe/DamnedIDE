// Pure rules for the worktree strip/header status (labels, colors, tooltips) and the cleanup
// dialog (which worktrees look useless). No React/electron deps, so it can be
// exercised with plain node (scripts/worktree-cleanup.check.ts).

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

/** Badge label in the worktree strip: 'main', the full PBI id, or the first 5 chars of the branch. */
export function stripLabel(branch: string, isMain: boolean): string {
  if (isMain) return 'main'
  const id = pbiIdFromBranch(branch)
  return id !== null ? String(id) : shortBranch(branch.replace(/^refs\/heads\//, '')).slice(0, 5)
}

/** Stack state chip of a stacked worktree (label, color, tooltip). */
export const STACK_LABELS: Record<WorktreeParentState, { label: string; color: string; tip: string }> = {
  open: { label: 'stacked', color: 'var(--accent-color)', tip: 'il padre non è ancora in develop' },
  merged: { label: 'padre in develop', color: 'var(--warning-color)', tip: 'il padre è già in develop: promuovi su develop' },
  absorbed: { label: 'assorbito', color: 'var(--success-color)', tip: 'il lavoro è già dentro il padre: il worktree può essere rimosso' },
  abandoned: { label: 'padre mancante', color: 'var(--error-color)', tip: 'il branch padre non esiste più' },
  rewritten: { label: 'base riscritta', color: 'var(--warning-color)', tip: 'la storia del padre è stata riscritta (force-push)' },
  unknown: { label: 'da verificare', color: 'var(--text-muted)', tip: 'stato non determinabile' }
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

/** One-line status for tooltips: "3 modifiche non committate · commit non in develop · ↑1 ↓2". */
export function overviewSummary(ov: OverviewStatus | null | undefined): string {
  if (!ov) return ''
  const parts: string[] = []
  if (ov.dirty) parts.push(ov.changes === 1 ? '1 modifica non committata' : `${ov.changes} modifiche non committate`)
  if (ov.unmerged) parts.push('commit non in develop')
  if (ov.upstreamGone) parts.push('nessun branch remoto')
  const sync = [ov.ahead > 0 ? `↑${ov.ahead}` : '', ov.behind > 0 ? `↓${ov.behind}` : ''].filter(Boolean).join(' ')
  if (sync) parts.push(`${sync} (rispetto all'ultimo fetch)`)
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
export function classifyCleanup(i: CleanupInput): CleanupResult {
  const locked = (reason: string): CleanupResult => ({ verdict: 'keep', locked: true, reasons: [reason] })
  if (i.isMain) return locked('checkout principale')
  if (!i.branch) return locked('HEAD detached')
  if (i.dirty === null) return locked('stato git non leggibile')
  if (i.dirty) return locked('modifiche non committate')
  if (i.localOnly === undefined) return locked('commit locali non verificabili')
  if (i.localOnly > 0) return locked(i.localOnly === 1 ? '1 commit non pushato' : `${i.localOnly} commit non pushati`)

  const reasons: string[] = []
  const state = typeof i.pbiState === 'string' ? i.pbiState.trim() : ''
  const closed = isPbiClosed(state)
  // an absorbed branch whose PBI is still open (New, Active...) is someone's live work
  const absorbed = i.stackState === 'absorbed' && (!state || closed)
  if (closed || absorbed) {
    if (closed) reasons.push(`PBI ${state}`)
    if (absorbed) reasons.push('lavoro già nel branch padre')
    if (i.unmerged) reasons.push('commit non in develop (pushati)')
    return { verdict: 'remove', locked: false, reasons }
  }
  if (!state && i.unmerged === false && i.upstreamGone) {
    reasons.push(i.pbiState === null ? 'PBI non trovato' : 'PBI non verificato')
    // ponytail: git cannot tell "never pushed" from "deleted after the PR": both are 'gone'
    reasons.push('già in develop, nessun branch remoto (rimosso dopo la PR o mai pubblicato)')
    return { verdict: 'maybe', locked: false, reasons }
  }
  if (state) reasons.push(`PBI ${state}`)
  else if (i.unmerged) reasons.push('commit non in develop')
  else if (i.unmerged === null) reasons.push('develop non trovato')
  else if (!i.upstreamGone && i.upstream) reasons.push(`${i.upstream} ancora presente`)
  else reasons.push('nessun upstream')
  return { verdict: 'keep', locked: false, reasons }
}
