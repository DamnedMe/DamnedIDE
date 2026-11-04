// Pure helpers for the release promotion pull requests (develop → qa → prod),
// shared by the renderer panel, the ADO service and scripts/ado-promotion.check.ts.
// No React / electron imports here.

export type EnvRole = 'dev' | 'qa' | 'prod'
export type PromotionStage = 'dev-qa' | 'qa-prod'
export type PromotionScope = 'be' | 'fe' | 'both'

export const STAGE_ROLES: Record<PromotionStage, { from: EnvRole; to: EnvRole }> = {
  'dev-qa': { from: 'dev', to: 'qa' },
  'qa-prod': { from: 'qa', to: 'prod' }
}

/** Branch names tried, in order, for each environment. */
export const BRANCH_CANDIDATES: Record<EnvRole, string[]> = {
  dev: ['develop', 'dev', 'development'],
  qa: ['qa', 'test', 'staging'],
  prod: ['main', 'master', 'prod', 'production']
}

/** Promotion settings saved per Azure DevOps org/project (promotionConfigKey). */
export interface PromotionConfig {
  /** ADO repository of the frontend (the backend is the open repository's connection) */
  feRepo?: string
  /** per ADO repository: branch names chosen by hand, used when they exist on the remote */
  branches?: Record<string, Partial<Record<EnvRole, string>>>
}

export function promotionConfigKey(org: string, project: string): string {
  return `${org.trim()}/${project.trim()}`.toLowerCase()
}

/**
 * The remote branch playing `role` (case-insensitive). An override wins when the
 * remote has it; otherwise the first BRANCH_CANDIDATES hit; null when none exists.
 */
export function resolveEnvBranch(role: EnvRole, remoteBranches: string[], override?: string): string | null {
  const find = (name: string) => remoteBranches.find(b => b.toLowerCase() === name.toLowerCase()) ?? null
  const wanted = override?.trim()
  if (wanted) {
    const hit = find(wanted)
    if (hit) return hit
  }
  for (const candidate of BRANCH_CANDIDATES[role]) {
    const hit = find(candidate)
    if (hit) return hit
  }
  return null
}

/** Every `#<id>` in the commit messages, deduped and sorted ('Merged PR 4521: #5444' → 5444). */
export function extractWorkItemIds(messages: string[]): number[] {
  const ids = new Set<number>()
  for (const message of messages) {
    for (const m of message.matchAll(/#(\d+)/g)) {
      const id = parseInt(m[1], 10)
      if (id > 0) ids.add(id)
    }
  }
  return [...ids].sort((a, b) => a - b)
}

const LONG_LIVED = new Set(Object.values(BRANCH_CANDIDATES).flat())

/** First line of a commit message, trimmed. */
export const firstLine = (message: string): string => (message.split(/\r?\n/)[0] || '').trim()

/** develop / qa / main and their aliases: branches a merge must never delete. */
export function isLongLivedBranch(name: string): boolean {
  return LONG_LIVED.has(name.replace(/^refs\/heads\//, '').trim().toLowerCase())
}

function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 'Release develop → qa · BE · 2026-11-04' (local date). */
export function promotionTitle(source: string, target: string, label: string, date: Date): string {
  return `Release ${source} → ${target} · ${label} · ${isoDay(date)}`
}

export interface PromotionWorkItem {
  id: number
  title?: string
  type?: string
  state?: string
}

/** ADO rejects pull request descriptions longer than 4000 characters. */
export const ADO_DESCRIPTION_MAX = 4000

/**
 * Work items section, then the first line of each commit; cut with '… +N altri'
 * so the text never exceeds `max` characters.
 */
export function promotionDescription(workItems: PromotionWorkItem[], commits: { message: string }[], max = ADO_DESCRIPTION_MAX): string {
  // [text, isEntry]: entries are what the '+N altri' tail counts
  const lines: [string, boolean][] = []
  if (workItems.length > 0) {
    lines.push([`## Work item (${workItems.length})`, false], ['', false])
    for (const w of workItems) {
      const meta = [w.type, w.state].filter(Boolean).join(' · ')
      lines.push([`- #${w.id}${w.title ? ` ${w.title}` : ''}${meta ? ` (${meta})` : ''}`, true])
    }
    lines.push(['', false])
  }
  lines.push([`## Commit (${commits.length})`, false], ['', false])
  for (const c of commits) lines.push([`- ${firstLine(c.message)}`, true])

  const full = lines.map(([text]) => text).join('\n')
  if (full.length <= max) return full

  const totalEntries = lines.filter(([, entry]) => entry).length
  const reserve = `\n… +${totalEntries} altri`.length
  let out = ''
  let shown = 0
  for (const [text, entry] of lines) {
    const next = out ? `${out}\n${text}` : text
    if (next.length + reserve > max) break
    out = next
    if (entry) shown++
  }
  return `${out}\n… +${totalEntries - shown} altri`.slice(0, max)
}
