// Self-check for GitService.discardChanges (worktree "annulla modifiche").
// Run: node --experimental-strip-types scripts/git-discard.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { GitService } from '../electron/services/git/git.service.ts'

const repo = mkdtempSync(join(tmpdir(), 'damned-discard-'))
const git = (args: string[]) => execFileSync('git', args, { cwd: repo, windowsHide: true })
git(['init', '-q'])
git(['config', 'user.email', 'test@test.local'])
git(['config', 'user.name', 'test'])
writeFileSync(join(repo, 'tracked.txt'), 'original\n')
git(['add', '.'])
git(['commit', '-q', '-m', 'init'])

const service = new GitService()

// 1. tracked, unstaged modification -> restored from HEAD
writeFileSync(join(repo, 'tracked.txt'), 'modified\n')
await service.discardChanges(repo, 'tracked.txt', {})
assert.equal(readFileSync(join(repo, 'tracked.txt'), 'utf-8').replace(/\r\n/g, '\n'), 'original\n', 'unstaged modification restored')

// 2. untracked new file -> deleted
writeFileSync(join(repo, 'new.txt'), 'brand new\n')
await service.discardChanges(repo, 'new.txt', { untracked: true })
assert.equal(existsSync(join(repo, 'new.txt')), false, 'untracked file deleted')

// 3. staged modification -> index + worktree restored
writeFileSync(join(repo, 'tracked.txt'), 'staged change\n')
git(['add', 'tracked.txt'])
await service.discardChanges(repo, 'tracked.txt', { staged: true })
assert.equal(readFileSync(join(repo, 'tracked.txt'), 'utf-8').replace(/\r\n/g, '\n'), 'original\n', 'staged modification restored')
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString().trim(), '', 'working tree clean after discard')

// 4. staged new file -> removed from index and disk
writeFileSync(join(repo, 'staged-new.txt'), 'x\n')
git(['add', 'staged-new.txt'])
await service.discardChanges(repo, 'staged-new.txt', { staged: true, untracked: true })
assert.equal(existsSync(join(repo, 'staged-new.txt')), false, 'staged new file removed')

rmSync(repo, { recursive: true, force: true })
console.log('ok — git discardChanges')
