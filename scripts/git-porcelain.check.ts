// Self-check for GitService.porcelain (worktree > changes list): every new file
// must come back as a readable path, never a collapsed folder or an escaped name.
// Run: node --experimental-strip-types scripts/git-porcelain.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { GitService } from '../electron/services/git/git.service.ts'

const repo = mkdtempSync(join(tmpdir(), 'damned-porcelain-'))
const git = (args: string[]) => execFileSync('git', args, { cwd: repo, windowsHide: true })
git(['init', '-q'])
git(['config', 'user.email', 'test@test.local'])
git(['config', 'user.name', 'test'])
git(['config', 'core.autocrlf', 'false'])
// the user's own config must not change what the panel sees
git(['config', 'core.quotePath', 'true'])
git(['config', 'status.showUntrackedFiles', 'no'])
mkdirSync(join(repo, 'src'))
writeFileSync(join(repo, 'src', 'tracked.cs'), 'class T {}\n')
git(['add', '.'])
git(['commit', '-q', '-m', 'init'])

// new file at an existing folder level, new file in a new nested folder,
// non-ASCII name, name with a space, staged-new-then-modified (AM)
writeFileSync(join(repo, 'plain.cs'), 'class Plain {}\n')
mkdirSync(join(repo, 'Feature', 'Sub'), { recursive: true })
writeFileSync(join(repo, 'Feature', 'Sub', 'c.cs'), 'class C {}\n')
writeFileSync(join(repo, 'src', 'àccent.cs'), 'class A {}\n')
writeFileSync(join(repo, 'src', 'with space.cs'), 'class S {}\n')
writeFileSync(join(repo, 'src', 'am.cs'), 'class Am {}\n')
git(['add', 'src/am.cs'])
writeFileSync(join(repo, 'src', 'am.cs'), 'class Am { int X; }\n')
// a plain modification, to prove the existing rows are unchanged
writeFileSync(join(repo, 'src', 'tracked.cs'), 'class T { int Y; }\n')

const p = await new GitService().porcelain(repo)
const byPath = (list: { path: string; changeType: string }[]) =>
  Object.fromEntries(list.map(f => [f.path, f.changeType]))

assert.deepEqual(byPath(p.staged), { 'src/am.cs': 'add' }, 'staged: only the AM file, as add')
assert.deepEqual(byPath(p.unstaged), {
  'Feature/Sub/c.cs': 'add',
  'plain.cs': 'add',
  'src/am.cs': 'edit',
  'src/tracked.cs': 'edit',
  'src/with space.cs': 'add',
  'src/àccent.cs': 'add'
}, 'unstaged: every file listed one by one, unquoted and unescaped')
assert.equal(p.unstaged.some(f => f.path.endsWith('/')), false, 'no collapsed folder rows')
assert.deepEqual(p.unmerged, [], 'no conflicts')

// every listed path must be readable from disk (what the preview does)
for (const f of [...p.staged, ...p.unstaged]) {
  assert.ok(readFileSync(join(repo, f.path), 'utf-8').length > 0, `readable: ${f.path}`)
}

rmSync(repo, { recursive: true, force: true })
console.log('ok — git porcelain')
