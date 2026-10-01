// Perf harness for the git/worktree services: timings at a given scale.
// Run: npm run test:perf-git  (defaults: 200 branches, 20 worktrees, 5000 files)
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitService } from '../electron/services/git/git.service.ts'
import { WorktreeService } from '../electron/services/git/worktree.service.ts'

const branches = Number(process.argv[2] || 200)
const worktrees = Number(process.argv[3] || 20)
const files = Number(process.argv[4] || 5000)

const root = mkdtempSync(join(tmpdir(), 'damned-perf-'))
const remote = join(root, 'remote.git')
const repo = join(root, 'repo')
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' })

function ms(label: string, fn: () => unknown): number {
  const t0 = performance.now()
  fn()
  const dt = performance.now() - t0
  console.log(`${label.padEnd(38)} ${dt.toFixed(0)} ms`)
  return dt
}

async function msAsync(label: string, fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now()
  await fn()
  const dt = performance.now() - t0
  console.log(`${label.padEnd(38)} ${dt.toFixed(0)} ms`)
  return dt
}

try {
  git(root, 'init', '--bare', '--initial-branch=develop', remote)
  git(root, 'clone', remote, repo)
  git(repo, 'config', 'user.email', 'perf@test')
  git(repo, 'config', 'user.name', 'perf')
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src', 'big.cs'), 'x'.repeat(1024 * 1024))
  for (let i = 0; i < files; i++) {
    const dir = join(repo, 'src', `d${i % 50}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `f${i}.cs`), `class F${i} {}\n`)
  }
  git(repo, 'add', '-A')
  git(repo, 'commit', '-m', 'base')
  git(repo, 'push', '-u', 'origin', 'develop')

  // branches
  for (let i = 0; i < branches; i++) git(repo, 'branch', `feature/b${i}`)
  // worktrees + stack links on some of them
  for (let i = 0; i < worktrees; i++) {
    git(repo, 'worktree', 'add', '-b', `wt/b${i}`, join(repo, '.worktrees', `wt${i}`))
    if (i % 4 === 0 && i > 0) {
      git(repo, 'config', `branch.wt/b${i}.damnedide-base`, `wt/b${i - 1}`)
      git(repo, 'config', `branch.wt/b${i}.damnedide-base-tip`, 'HEAD')
    }
  }
  // local modifications (what the worktree panel shows)
  for (let i = 0; i < 200; i++) writeFileSync(join(repo, 'src', `d${i % 50}`, `f${i}.cs`), `class F${i} { int X; }\n`)

  const gitService = new GitService()
  const worktreeService = new WorktreeService({})

  console.log(`repo: ${files} file, ${branches} branch, ${worktrees} worktree\n`)
  await msAsync('git.status', () => gitService.status(repo))
  await msAsync('git.porcelain', () => gitService.porcelain(repo))
  await msAsync('git.resolveRepoRoot (repo)', () => gitService.resolveRepoRoot(repo))
  await msAsync('git.resolveRepoRoot (nested)', () => gitService.resolveRepoRoot(join(repo, 'src', 'd1')))
  await msAsync('git.showFile (1MB)', () => gitService.showFile(repo, 'src/big.cs'))
  await msAsync('git.diffFile (1MB, unmodified)', () => gitService.diffFile(repo, 'src/big.cs'))
  await msAsync('worktree.list', () => worktreeService.list(repo))
  await msAsync('worktree.prune', () => worktreeService.prune(repo))
  await msAsync('worktree.stack', () => worktreeService.stack(repo))
  await msAsync('loadWorktrees (prune+list+stack)', async () => {
    await worktreeService.prune(repo)
    await worktreeService.list(repo)
    await worktreeService.stack(repo)
  })
  await msAsync('worktree.add (local remote)', () => worktreeService.add(repo, 'feature/new-perf', join(repo, '.worktrees', 'new-perf')))
  await msAsync('worktree.remove (new-perf)', () => worktreeService.remove(repo, join(repo, '.worktrees', 'new-perf'), true))
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* windows locks */ }
}
