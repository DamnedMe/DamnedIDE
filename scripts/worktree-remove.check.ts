// Self-check for WorktreeService.remove (plain + forced), including the guard
// that never deletes the main repository.
// Run: node --experimental-strip-types scripts/worktree-remove.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { WorktreeService, moveToTrash, scheduleDelete, cancelScheduledDeletes } from '../electron/services/git/worktree.service.ts'

const root = mkdtempSync(join(tmpdir(), 'damned-wt-'))
const repo = join(root, 'repo')
mkdirSync(repo)
const git = (args: string[]) => execFileSync('git', args, { cwd: repo, windowsHide: true })
git(['init', '-q'])
git(['config', 'user.email', 'test@test.local'])
git(['config', 'user.name', 'test'])
writeFileSync(join(repo, 'a.txt'), 'a\n')
git(['add', '.'])
git(['commit', '-q', '-m', 'init'])

const service = new WorktreeService()

// plain removal
const wt1 = join(root, 'wt1')
git(['worktree', 'add', '-q', wt1, '-b', 'feature/one', 'HEAD'])
assert.equal(existsSync(wt1), true)
const r1 = await service.remove(repo, wt1, false)
assert.equal(r1.ok, true, 'plain removal succeeds')
assert.equal(existsSync(wt1), false, 'worktree folder deleted')
const list1 = await service.list(repo)
assert.equal(list1.some(e => e.path.includes('wt1')), false, 'wt1 no longer registered')

// forced removal (used when the folder is locked)
const wt2 = join(root, 'wt2')
git(['worktree', 'add', '-q', wt2, '-b', 'feature/two', 'HEAD'])
const r2 = await service.remove(repo, wt2, true)
assert.equal(r2.ok, true, 'forced removal succeeds')
assert.equal(existsSync(wt2), false, 'worktree folder deleted on force')

// guard: removing the main repo only prunes, never deletes it
const r3 = await service.remove(repo, repo, true)
assert.equal(r3.ok, true)
assert.equal(existsSync(repo), true, 'main repository is never deleted')

// locked folder fallback: moveToTrash frees the path, scheduleDelete cleans it
const locked = join(root, 'locked-worktree')
mkdirSync(locked)
writeFileSync(join(locked, 'held.txt'), 'open elsewhere\n')
const trashed = await moveToTrash(locked)
assert.ok(trashed, 'moveToTrash returns the new path')
assert.equal(existsSync(locked), false, 'original path is freed immediately')
assert.equal(existsSync(join(trashed!, 'held.txt')), true, 'content preserved in the trash')
scheduleDelete(trashed!, { attempts: 10, intervalMs: 50, initialDelayMs: 30 })
await new Promise((r) => setTimeout(r, 300))
assert.equal(existsSync(trashed!), false, 'scheduled deletion removes the trashed folder')
cancelScheduledDeletes()

rmSync(root, { recursive: true, force: true })
console.log('ok — worktree remove')
