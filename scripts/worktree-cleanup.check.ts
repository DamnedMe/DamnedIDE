// Self-check for the worktree list status and the bulk cleanup: overview()
// (dirty, ahead/behind, upstream gone, commits not in develop, local-only
// commits), removeSafe() refusals, and the pure classify/pbi rules.
// Run: node --experimental-strip-types scripts/worktree-cleanup.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { WorktreeService, parseTrack, revParseCommit } from '../electron/services/git/worktree.service.ts'
import type { WorktreeOverview } from '../electron/services/git/worktree.service.ts'
import {
  classifyCleanup, pbiIdFromBranch, worktreeTone, overviewSummary, stripLabel, stripBadge, STACK_LABELS
} from '../src/components/worktree/worktree-cleanup.ts'
import type { CleanupInput } from '../src/components/worktree/worktree-cleanup.ts'
import simpleGit from 'simple-git'

// ─── pure rules ──────────────────────────────────────────────────────────────
assert.deepEqual(parseTrack('ahead 2, behind 3'), { ahead: 2, behind: 3, gone: false })
assert.deepEqual(parseTrack('behind 1'), { ahead: 0, behind: 1, gone: false })
assert.deepEqual(parseTrack('ahead 4'), { ahead: 4, behind: 0, gone: false })
assert.deepEqual(parseTrack('gone'), { ahead: 0, behind: 0, gone: true })
assert.deepEqual(parseTrack(''), { ahead: 0, behind: 0, gone: false })

assert.equal(pbiIdFromBranch('feature/5444'), 5444)
assert.equal(pbiIdFromBranch('bugfix/12345-x'), 12345)
assert.equal(pbiIdFromBranch('refs/heads/feature/77'), 77)
assert.equal(pbiIdFromBranch('develop'), null)
assert.equal(pbiIdFromBranch(''), null)
assert.equal(pbiIdFromBranch('release/2024.11'), null, 'only feature/bugfix branches carry a PBI id')
assert.equal(pbiIdFromBranch('hotfix/1.2.3'), null)
assert.equal(stripLabel('release/2024.11', false), '2024.', 'no PBI id: first 5 chars of the last segment')

assert.equal(stripLabel('feature/12345', false), '12345', '5-digit ids are not truncated')
assert.equal(stripLabel('refs/heads/bugfix/5461-null-check', false), '5461', 'bugfix id without its text')
assert.equal(stripLabel('develop', true), 'main', 'the main checkout')
assert.equal(stripLabel('feature/refactor-login', false), 'refac', 'non-numeric branch: first 5 chars of the last segment')
assert.equal(stripLabel('refs/heads/develop', false), 'devel')
assert.equal(stripLabel('', false), '', 'detached: the caller falls back to the head')
// strip badge (D1): kind logo/ring, uncommitted bubble, done mark, ↑/↓
const ovClean = { dirty: false, changes: 0, ahead: 0, behind: 0 }
assert.equal(stripBadge('develop', true, ovClean).kind, 'main', 'the main checkout is main whatever its branch')
assert.equal(stripBadge('bugfix/6153', false, ovClean).kind, 'bug')
assert.equal(stripBadge('refs/heads/feature/6077', false, ovClean).kind, 'pbi')
assert.equal(stripBadge('feature/refactor-login', false, ovClean).kind, 'pbi', 'a feature branch without an id is still PBI work')
assert.equal(stripBadge('release/2024.11', false, ovClean).kind, 'branch')
assert.equal(stripBadge('', false, ovClean).kind, 'detached')
assert.equal(stripBadge('bugfix/1', false, { ...ovClean, dirty: true, changes: 3 }).dirty, '3')
assert.equal(stripBadge('bugfix/1', false, { ...ovClean, dirty: true, changes: 250 }).dirty, '99+', 'the bubble stays small')
assert.equal(stripBadge('bugfix/1', false, { ...ovClean, dirty: true, changes: 0 }).dirty, '!', 'dirty without a count still shows')
assert.equal(stripBadge('bugfix/1', false, ovClean).dirty, null, 'clean: no bubble')
assert.equal(stripBadge('bugfix/1', false, undefined).dirty, null, 'unknown status: no bubble')
assert.equal(stripBadge('feature/1', false, ovClean, 'Done').done, true, 'PBI Done + clean -> done')
assert.equal(stripBadge('feature/1', false, ovClean, 'removed').done, true, 'state compared case-insensitively')
assert.equal(stripBadge('feature/1', false, ovClean, 'Active').done, false, 'open PBI -> not done')
assert.equal(stripBadge('feature/1', false, { ...ovClean, dirty: true, changes: 1 }, 'Done').done, false, 'uncommitted work is never shown as done')
assert.equal(stripBadge('feature/1', false, undefined, 'Done').done, false, 'unknown status -> not done')
assert.equal(stripBadge('feature/1', false, { ...ovClean, ahead: 2 }, 'Done').done, false, 'commits still to push are never shown as done')
assert.equal(stripBadge('feature/1', false, ovClean).done, false, 'no ADO -> not done')
assert.equal(stripBadge('develop', true, ovClean, 'Done').done, false, 'the main checkout is never done')
assert.deepEqual([stripBadge('main', true, { ...ovClean, ahead: 2, behind: 4 }).ahead, stripBadge('main', true, { ...ovClean, ahead: 2, behind: 4 }).behind], [2, 4])
assert.deepEqual([stripBadge('main', true, undefined).ahead, stripBadge('main', true, undefined).behind], [0, 0])
assert.deepEqual(Object.keys(STACK_LABELS).sort(), ['abandoned', 'absorbed', 'merged', 'open', 'rewritten', 'unknown'])

assert.equal(worktreeTone({ dirty: true, unmerged: true }), 'dirty')
assert.equal(worktreeTone({ dirty: false, unmerged: true }), 'unmerged')
assert.equal(worktreeTone({ dirty: false, unmerged: false }), 'clean')
assert.equal(worktreeTone({ dirty: null, unmerged: false }), null)
assert.equal(worktreeTone(undefined), null)
assert.equal(
  overviewSummary({ dirty: true, changes: 3, unmerged: true, upstreamGone: false, ahead: 1, behind: 2 }),
  "3 modifiche non committate · commit non in develop · ↑1 ↓2 (rispetto all'ultimo fetch)"
)
assert.equal(overviewSummary({ dirty: false, changes: 0, unmerged: false, upstreamGone: false, ahead: 0, behind: 0 }), '')

const safe: CleanupInput = { isMain: false, branch: 'feature/1', dirty: false, localOnly: 0, upstreamGone: true, unmerged: false }
assert.equal(classifyCleanup({ ...safe, pbiState: 'Done' }).verdict, 'remove', 'Done + clean -> remove')
assert.equal(classifyCleanup({ ...safe, pbiState: 'closed' }).verdict, 'remove', 'state compared case-insensitively')
assert.equal(classifyCleanup({ ...safe, pbiState: 'Removed', unmerged: true, upstreamGone: false }).verdict, 'remove', 'pushed but unmerged with a Removed PBI')
assert.ok(classifyCleanup({ ...safe, pbiState: 'Removed', unmerged: true }).reasons.includes('commit non in develop (pushati)'))
const doneDirty = classifyCleanup({ ...safe, pbiState: 'Done', dirty: true })
assert.equal(doneDirty.verdict, 'keep', 'Done + dirty -> keep')
assert.equal(doneDirty.locked, true, 'Done + dirty -> locked')
assert.equal(classifyCleanup({ ...safe, pbiState: 'Done', dirty: null }).locked, true, 'unknown dirty -> locked')
assert.equal(classifyCleanup({ ...safe, pbiState: 'Done', localOnly: 2 }).locked, true, 'local-only commits -> locked')
assert.equal(classifyCleanup({ ...safe, pbiState: 'Done', localOnly: undefined }).locked, true, 'unknown local-only -> locked')
assert.equal(classifyCleanup({ ...safe, pbiState: 'Done', isMain: true }).locked, true, 'main never')
assert.equal(classifyCleanup({ ...safe, pbiState: 'Done', branch: '' }).locked, true, 'detached never')
const active = classifyCleanup({ ...safe, pbiState: 'Active' })
assert.equal(active.verdict, 'keep', 'Active -> keep')
assert.equal(active.locked, false, 'Active -> still selectable')
assert.deepEqual(active.reasons, ['PBI Active'])
assert.equal(classifyCleanup({ ...safe, pbiState: 'Resolved' }).verdict, 'keep', 'Resolved is still open')
assert.equal(classifyCleanup(safe).verdict, 'maybe', 'unknown PBI + merged + gone -> maybe')
assert.equal(classifyCleanup({ ...safe, pbiState: null }).verdict, 'maybe', 'PBI not found + merged + gone -> maybe')
assert.equal(classifyCleanup({ ...safe, upstreamGone: false, upstream: 'origin/feature/1' }).verdict, 'keep', 'remote still there -> keep')
assert.equal(classifyCleanup({ ...safe, unmerged: true }).verdict, 'keep', 'unknown PBI + unmerged -> keep')
assert.equal(classifyCleanup({ ...safe, unmerged: null }).verdict, 'keep', 'no develop -> keep')
assert.equal(classifyCleanup({ ...safe, stackState: 'absorbed', upstreamGone: false, unmerged: true }).verdict, 'remove', 'absorbed -> remove')
assert.equal(classifyCleanup({ ...safe, stackState: 'absorbed', pbiState: 'Active', upstreamGone: false, unmerged: true }).verdict, 'keep', 'absorbed but PBI still open -> keep')
assert.equal(classifyCleanup({ ...safe, stackState: 'absorbed', pbiState: 'Done', upstreamGone: false, unmerged: true }).verdict, 'remove', 'absorbed + PBI Done -> remove')

// ─── service, on a bare remote + clone ───────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'damned-cleanup-'))
const remote = join(root, 'remote.git')
const repo = join(root, 'repo')
const other = join(root, 'other')
const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const identity = (cwd: string) => {
  git(['config', 'user.email', 'test@test.local'], cwd)
  git(['config', 'user.name', 'test'], cwd)
}
const commitFile = (cwd: string, name: string) => {
  writeFileSync(join(cwd, name), `${name}\n`)
  git(['add', '.'], cwd)
  git(['commit', '-q', '-m', name], cwd)
}

git(['init', '--bare', '-q', remote], root)
git(['clone', '-q', remote, repo], root)
identity(repo)
commitFile(repo, 'a.txt')
git(['branch', '-M', 'develop'])
git(['push', '-q', '-u', 'origin', 'develop'])

const service = new WorktreeService()
const wt = (id: string) => join(repo, '.worktrees', 'feature', id)
const byBranch = (list: WorktreeOverview[], branch: string) => {
  const ov = list.find(o => o.branch === branch)
  assert.ok(ov, `overview has ${branch}`)
  return ov
}

// never pushed: the upstream is configured by add() but its remote ref is missing
await service.add(repo, 'feature/1001', wt('1001'))
// pushed, then one more local commit
await service.add(repo, 'feature/1002', wt('1002'))
commitFile(wt('1002'), 'b.txt')
git(['push', '-q', 'origin', 'feature/1002'], wt('1002'))
commitFile(wt('1002'), 'c.txt')
// merged --no-ff into develop, remote branch deleted after the "PR"
await service.add(repo, 'feature/1003', wt('1003'))
commitFile(wt('1003'), 'd.txt')
git(['push', '-q', 'origin', 'feature/1003'], wt('1003'))
git(['merge', '--no-ff', '-q', '-m', 'merge 1003', 'feature/1003'])
git(['push', '-q', 'origin', 'develop'])
git(['push', '-q', 'origin', '--delete', 'feature/1003'])
git(['fetch', '-q', '--prune'])

let ov = await service.overview(repo, { localOnly: true })
assert.equal(ov.length, 4, 'main checkout + 3 worktrees')

const never = byBranch(ov, 'feature/1001')
assert.equal(never.upstream, 'origin/feature/1001')
assert.equal(never.upstreamGone, true, 'never pushed reads as gone')
assert.equal(never.ahead, 0)
assert.equal(never.behind, 0)
assert.equal(never.unmerged, false)
assert.equal(never.dirty, false)
assert.equal(never.localOnly, 0)
assert.equal(never.base, 'origin/develop')

const pushed = byBranch(ov, 'feature/1002')
assert.equal(pushed.ahead, 1, 'one commit to push')
assert.equal(pushed.behind, 0)
assert.equal(pushed.upstreamGone, false)
assert.equal(pushed.unmerged, true)
assert.equal(pushed.localOnly, 1)

const merged = byBranch(ov, 'feature/1003')
assert.equal(merged.upstreamGone, true, 'remote deleted + fetch --prune')
assert.equal(merged.unmerged, false, 'merged into develop')
assert.equal(merged.localOnly, 0)
assert.equal(merged.dirty, false)

const main = byBranch(ov, 'develop')
assert.equal(main.dirty, false, 'the .worktrees/ folder inside the repo is not a change')
assert.equal(main.behind, 0)
assert.equal(main.unmerged, false)
assert.equal(main.localOnly, 0)

// localOnly only on request
assert.equal(byBranch(await service.overview(repo), 'feature/1002').localOnly, undefined)

// someone else pushes to feature/1002 and to develop
git(['clone', '-q', remote, other], root)
identity(other)
git(['checkout', '-q', 'feature/1002'], other)
commitFile(other, 'e.txt')
git(['push', '-q', 'origin', 'feature/1002'], other)
git(['checkout', '-q', 'develop'], other)
commitFile(other, 'f.txt')
git(['push', '-q', 'origin', 'develop'], other)
git(['fetch', '-q'])

// untracked file: dirty (the user's 'A' files)
writeFileSync(join(wt('1001'), 'new.txt'), 'x\n')

ov = await service.overview(repo, { localOnly: true })
assert.equal(byBranch(ov, 'feature/1002').behind, 1, 'teammate commit to pull')
assert.equal(byBranch(ov, 'feature/1002').ahead, 1)
assert.ok(byBranch(ov, 'develop').behind > 0, 'main checkout behind origin/develop')
assert.equal(byBranch(ov, 'feature/1001').dirty, true)
assert.equal(byBranch(ov, 'feature/1001').changes, 1)

// the app passes the paths `git worktree list` reports (tmpdir can be an 8.3 short path)
const pathOf = (branch: string) => byBranch(ov, branch).path

// paths limits the result
const one = await service.overview(repo, { paths: [pathOf('feature/1001')] })
assert.equal(one.length, 1)
assert.equal(one[0].branch, 'feature/1001')

// ─── removeSafe ──────────────────────────────────────────────────────────────
const dirty = await service.removeSafe(repo, pathOf('feature/1001'))
assert.equal(dirty.ok, false)
assert.equal(dirty.skipped, true, 'dirty refused')
assert.match(dirty.error || '', /modifiche non committate/)
assert.ok(existsSync(wt('1001')), 'dirty worktree untouched')

const unpushed = await service.removeSafe(repo, pathOf('feature/1002'))
assert.equal(unpushed.skipped, true, 'local-only commits refused')
assert.match(unpushed.error || '', /non pushat/)
assert.ok(existsSync(wt('1002')))

// forced retry (locked folder): the same checks run again before deleting
let tornDown = 0
const teardown = () => { tornDown++ }
const forcedDirty = await service.removeSafe(repo, pathOf('feature/1001'), teardown)
assert.equal(forcedDirty.skipped, true, 'forced retry still refuses untracked files')
assert.equal(tornDown, 0, 'terminals are closed only once the checks pass')
await service.add(repo, 'feature/1004', wt('1004'))
const path1004 = (await service.list(repo)).find(e => e.branch === 'feature/1004')!.path
rmSync(join(wt('1004'), 'a.txt')) // what a half-done rm leaves: a tracked file deleted
const halfPlain = await service.removeSafe(repo, path1004)
assert.equal(halfPlain.skipped, true, 'plain pass: a deleted tracked file still counts as a change')
const halfForced = await service.removeSafe(repo, path1004, teardown)
assert.equal(halfForced.ok, true, halfForced.error)
assert.equal(tornDown, 1, 'teardown ran once, after the checks')
assert.ok(!existsSync(wt('1004')), 'forced retry removed the half-deleted worktree')

const mainRes = await service.removeSafe(repo, repo)
assert.equal(mainRes.skipped, true, 'main checkout refused')
assert.ok(existsSync(join(repo, 'a.txt')))

const stranger = await service.removeSafe(repo, join(root, 'nope', '.worktrees', 'x'))
assert.equal(stranger.skipped, true, 'not a worktree of this repository')

const removed = await service.removeSafe(repo, pathOf('feature/1003'))
assert.equal(removed.ok, true, removed.error)
assert.ok(!existsSync(wt('1003')), 'folder deleted')
assert.ok(!(await service.list(repo)).some(e => e.branch === 'feature/1003'), 'worktree unregistered')
assert.ok(await revParseCommit(simpleGit(repo), 'refs/heads/feature/1003'), 'local branch kept')

rmSync(root, { recursive: true, force: true })
console.log('ok — worktree cleanup')
