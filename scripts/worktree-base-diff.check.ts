// Self-check for the "diff with develop" view: changes since the branch left its
// base, commits (pushed or not) aggregated with pending and untracked changes.
// Run: node --experimental-strip-types scripts/worktree-base-diff.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { WorktreeService, parseNameStatusZ } from '../electron/services/git/worktree.service.ts'

assert.deepEqual(parseNameStatusZ(''), [])
assert.deepEqual(parseNameStatusZ('M\0a b.txt\0R087\0old.txt\0new.txt\0D\0gone.txt\0'), [
  { path: 'a b.txt', status: 'M' },
  { path: 'new.txt', status: 'R', oldPath: 'old.txt' },
  { path: 'gone.txt', status: 'D' }
])

const root = mkdtempSync(join(tmpdir(), 'damned-basediff-'))
const remote = join(root, 'remote.git')
const repo = join(root, 'repo')
const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, windowsHide: true })
try {
  git(['init', '--bare', '-q', remote], root)
  git(['clone', '-q', remote, repo], root)
  git(['config', 'user.email', 'test@test.local'])
  git(['config', 'user.name', 'test'])
  writeFileSync(join(repo, 'keep.txt'), 'keep\n')
  writeFileSync(join(repo, 'edit.txt'), 'one\n')
  writeFileSync(join(repo, 'drop.txt'), 'drop\n')
  writeFileSync(join(repo, 'move.txt'), 'a long enough body\nto be detected\nas a rename\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'init'])
  git(['branch', '-M', 'develop'])
  git(['push', '-q', '-u', 'origin', 'develop'])

  const service = new WorktreeService()
  const wt = join(root, 'wt')
  await service.add(repo, 'feature/x', wt)
  const commit = (msg: string) => { git(['add', '-A'], wt); git(['commit', '-q', '-m', msg], wt) }

  writeFileSync(join(wt, 'edit.txt'), 'one\ntwo\n')
  commit('first')
  git(['rm', '-q', 'drop.txt'], wt)
  renameSync(join(wt, 'move.txt'), join(wt, 'moved.txt'))
  commit('second')
  git(['push', '-q', '-u', 'origin', 'feature/x'], wt)
  writeFileSync(join(wt, 'edit.txt'), 'one\ntwo\nthree\n') // pending, on a committed file
  writeFileSync(join(wt, 'new.txt'), 'new\n') // untracked

  // develop moves on meanwhile: its changes are not the branch's
  writeFileSync(join(repo, 'keep.txt'), 'changed on develop\n')
  git(['commit', '-q', '-am', 'develop work'])
  git(['push', '-q', 'origin', 'develop'])
  git(['fetch', '-q'], wt)

  const diff = await service.baseDiff(wt)
  assert.equal(diff.base, 'origin/develop', 'the remote base is preferred')
  assert.deepEqual(diff.files, [
    { path: 'drop.txt', status: 'D' },
    { path: 'edit.txt', status: 'M' },
    { path: 'moved.txt', status: 'R', oldPath: 'move.txt' },
    { path: 'new.txt', status: 'A' }
  ], 'two commits + pending + untracked, one row per file, develop changes excluded')

  await assert.rejects(() => service.baseDiff(wt, 'missing'), /non trovato/)
  console.log('worktree-base-diff: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
}
