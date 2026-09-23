// Self-check for WorktreeService.add: creates a worktree from develop, creates
// the missing parent folders, and reports a clear error when the folder is not a
// git repository (the old behaviour was git's bare "not a git repository").
// Run: node --experimental-strip-types scripts/worktree-add.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { WorktreeService } from '../electron/services/git/worktree.service.ts'

const root = mkdtempSync(join(tmpdir(), 'damned-wt-add-'))
const remote = join(root, 'remote.git')
const repo = join(root, 'repo')
const run = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, windowsHide: true })

run(root, ['init', '--bare', '-q', remote])
run(root, ['clone', '-q', remote, repo])
run(repo, ['config', 'user.email', 'test@test.local'])
run(repo, ['config', 'user.name', 'test'])
writeFileSync(join(repo, 'a.txt'), 'a\n')
run(repo, ['add', '.'])
run(repo, ['commit', '-q', '-m', 'init'])
run(repo, ['branch', '-M', 'develop'])
run(repo, ['push', '-q', '-u', 'origin', 'develop'])

const service = new WorktreeService()

// nested parents do not exist yet: add must create them
const wt = join(root, '.worktrees', 'feature', '1234')
assert.equal(existsSync(join(root, '.worktrees')), false, 'parents are missing before add')
await service.add(repo, 'feature/1234', wt)
assert.equal(existsSync(wt), true, 'worktree folder created')
assert.equal(existsSync(join(wt, 'a.txt')), true, 'worktree contains the repository files')
const branch = execFileSync('git', ['branch', '--list', 'feature/1234'], { cwd: repo }).toString()
assert.match(branch, /feature\/1234/, 'branch created')
const list = await service.list(repo)
assert.ok(list.some(e => e.path.replace(/\\/g, '/').endsWith('.worktrees/feature/1234')), 'worktree registered')

// not a git repository: actionable message instead of git's raw error
const notRepo = join(root, 'not-a-repo')
mkdirSync(notRepo)
await assert.rejects(
  () => service.add(notRepo, 'feature/x', join(root, 'x')),
  /non è un repository git/i,
  'add on a non-repo folder must explain what to do'
)
await assert.rejects(() => service.list(notRepo), /non è un repository git/i, 'list on a non-repo folder too')

rmSync(root, { recursive: true, force: true })
console.log('ok — worktree add')
