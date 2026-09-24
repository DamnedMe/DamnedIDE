// Self-check for stacked worktrees: link storage, parent state machine,
// children re-target and the "branch already in use" guard.
// Run: node --experimental-strip-types scripts/worktree-stack.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import simpleGit from 'simple-git'
import {
  WorktreeService, readStackLink, writeStackLink, revParseCommit
} from '../electron/services/git/worktree.service.ts'
import { GitService } from '../electron/services/git/git.service.ts'

const root = mkdtempSync(join(tmpdir(), 'damned-stack-'))
const remote = join(root, 'remote.git')
const repo = join(root, 'repo')
const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, windowsHide: true })

git(['init', '--bare', '-q', remote], root)
git(['clone', '-q', remote, repo], root)
git(['config', 'user.email', 'test@test.local'])
git(['config', 'user.name', 'test'])
writeFileSync(join(repo, 'a.txt'), 'a\n')
git(['add', '.'])
git(['commit', '-q', '-m', 'init'])
git(['branch', '-M', 'develop'])
git(['push', '-q', '-u', 'origin', 'develop'])

const service = new WorktreeService()
const sg = simpleGit(repo)
const parentPath = join(root, '.worktrees', 'feature', 'parent')
const childPath = join(root, '.worktrees', 'feature', 'child')

// ─── creation with a base ────────────────────────────────────────────────────
await service.add(repo, 'feature/parent', parentPath)
await service.add(repo, 'feature/child', childPath, 'feature/parent')

const link = await readStackLink(sg, 'feature/child')
assert.equal(link?.parent, 'feature/parent', 'link recorded on the child branch')
assert.ok(link?.tip, 'base tip recorded')

const open = await service.stack(repo)
assert.equal(open.length, 1, 'only the stacked branch has a link')
assert.equal(open[0].state, 'open')
assert.equal(open[0].mergeRef, 'feature/parent', 'local parent ref used while not pushed')

// a branch can live in a single worktree
await assert.rejects(() => service.add(repo, 'feature/child', join(root, 'other')), /già usato/i)

// ─── parent advanced ─────────────────────────────────────────────────────────
writeFileSync(join(parentPath, 'b.txt'), 'b\n')
git(['add', '.'], parentPath)
git(['commit', '-q', '-m', 'parent work'], parentPath)
const advanced = await service.stack(repo)
assert.equal(advanced[0].behindParent, 1, 'base avanzata detected')

// publishing the parent makes it the alignment ref for the child (needed for the PR)
await new GitService().pushBranch(childPath, 'feature/parent')
const published = await service.stack(repo)
assert.equal(published[0].mergeRef, 'origin/feature/parent', 'remote parent preferred once pushed')

// ─── parent merged into develop ──────────────────────────────────────────────
git(['merge', '--no-ff', '-q', '-m', 'merge parent', 'feature/parent'])
git(['push', '-q', 'origin', 'develop'])
const merged = await service.stack(repo)
assert.equal(merged[0].state, 'merged', 'parent detected in develop')
assert.equal(merged[0].mergeRef, 'origin/develop', 'alignment switches to develop')

// ─── child absorbed by the parent ────────────────────────────────────────────
writeFileSync(join(childPath, 'c.txt'), 'c\n')
git(['add', '.'], childPath)
git(['commit', '-q', '-m', 'child work'], childPath)
git(['merge', '--no-ff', '-q', '-m', 'absorb child', 'feature/child'], parentPath)
const absorbed = await service.stack(repo)
assert.equal(absorbed[0].state, 'absorbed', 'child work inside the parent')

// ─── re-target the children (removal guard) ──────────────────────────────────
const affected = await service.retargetChildren(repo, 'feature/parent')
assert.deepEqual(affected, ['feature/child'], 'child re-targeted')
assert.equal(await readStackLink(sg, 'feature/child'), null, 'link cleared')
assert.equal((await service.stack(repo)).length, 0)

// ─── abandoned parent ────────────────────────────────────────────────────────
await writeStackLink(sg, 'feature/child', 'feature/parent', (await revParseCommit(sg, 'feature/parent')) || undefined)
await service.remove(repo, parentPath, true)
git(['branch', '-D', 'feature/parent'])
git(['push', '-q', 'origin', '--delete', 'feature/parent'])
const abandoned = await service.stack(repo)
assert.equal(abandoned[0].state, 'abandoned', 'missing parent detected')

rmSync(root, { recursive: true, force: true })
console.log('ok — worktree stack')
