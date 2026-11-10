// Self-check for the recursive tree watcher (auto-refresh of changes).
// Run: node --experimental-strip-types scripts/fs-watch.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchTree, IGNORED, createIgnore } from '../electron/services/watch/tree-watcher.ts'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const root = mkdtempSync(join(tmpdir(), 'damned-watch-'))
// the watched root is itself a worktree (`.git` file): it must not be ignored
writeFileSync(join(root, '.git'), 'gitdir: ../main/.git/worktrees/x\n')
mkdirSync(join(root, 'src'))
mkdirSync(join(root, 'node_modules'))
// a worktree inside the checkout under a root other than `.worktrees` (Settings › Git › Worktree root)
mkdirSync(join(root, 'feature', '1234', 'src'), { recursive: true })
writeFileSync(join(root, 'feature', '1234', '.git'), 'gitdir: ../../.git/worktrees/1234\n')

let hits = 0
const close = await watchTree(root, () => { hits++ })

writeFileSync(join(root, 'src', 'a.cs'), 'class A {}\n')
await delay(700)
assert.ok(hits > 0, 'a change under a subdirectory must fire the watcher')

const afterFirst = hits
writeFileSync(join(root, 'node_modules', 'ignored.js'), 'x\n')
await delay(700)
assert.equal(hits, afterFirst, 'ignored directories must not fire the watcher')

// the first write in a fresh folder can update the last-access time of the folder holding the
// worktree (Windows reports a `change` of `feature`, then stays quiet for a while): the same noise
// as any read of the checkout, not the worktree's edits, so warm it up before counting
writeFileSync(join(root, 'feature', '1234', 'src', 'b.cs'), 'class B {}\n')
await delay(700)
const afterWarmUp = hits
writeFileSync(join(root, 'feature', '1234', 'src', 'b.cs'), 'class B { }\n')
writeFileSync(join(root, 'feature', '1234', 'src', 'b2.cs'), 'class B2 {}\n')
await delay(700)
assert.equal(hits, afterWarmUp, 'edits inside a nested worktree must not fire the watcher')

// a worktree created while the watcher runs: its folder is checked before `.git` exists
mkdirSync(join(root, 'pbi', '99'), { recursive: true })
await delay(500)
writeFileSync(join(root, 'pbi', '99', '.git'), 'gitdir: ../../.git/worktrees/99\n')
writeFileSync(join(root, 'pbi', '99', 'c.cs'), 'class C {}\n')
await delay(700)
const afterCreate = hits
writeFileSync(join(root, 'pbi', '99', 'c.cs'), 'class C { }\n')
writeFileSync(join(root, 'pbi', '99', 'c2.cs'), 'class C2 {}\n')
await delay(700)
assert.equal(hits, afterCreate, 'a worktree created after the watcher started must be ignored too')

assert.ok(IGNORED.test('src/bin/Debug/x.dll'), 'bin must be ignored')
assert.ok(IGNORED.test('.git/index'), '.git must be ignored')
assert.ok(!IGNORED.test('src/Program.cs'), 'normal sources must not be ignored')

const ignored = createIgnore(root)
assert.ok(ignored('feature/1234/src/b.cs'), 'a file inside a nested worktree is ignored')
assert.ok(ignored('feature\\1234'), 'the nested worktree folder itself is ignored (Windows separators)')
assert.ok(!ignored('feature'), 'the folder holding worktrees is not ignored')
assert.ok(!ignored('src/a.cs'), 'sources of the watched root are not ignored, even when the root has a `.git`')
assert.ok(ignored('node_modules/x.js'), 'the IGNORED names still apply')
// cached "not nested", then the folder becomes a repository: the `.git` event invalidates it
mkdirSync(join(root, 'wt', '7'), { recursive: true })
assert.ok(!ignored('wt/7/d.cs'))
mkdirSync(join(root, 'wt', '7', '.git'))
assert.ok(ignored('wt/7/.git'), 'the `.git` entry itself is ignored')
assert.ok(ignored('wt/7/d.cs'), 'a folder that gained a `.git` is ignored after its `.git` event')

close()
rmSync(root, { recursive: true, force: true })
console.log('ok — fs watch')
