// Self-check for the recursive tree watcher (auto-refresh of changes).
// Run: node --experimental-strip-types scripts/fs-watch.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchTree, IGNORED } from '../electron/services/watch/tree-watcher.ts'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const root = mkdtempSync(join(tmpdir(), 'damned-watch-'))
mkdirSync(join(root, 'src'))
mkdirSync(join(root, 'node_modules'))

let hits = 0
const close = await watchTree(root, () => { hits++ })

writeFileSync(join(root, 'src', 'a.cs'), 'class A {}\n')
await delay(700)
assert.ok(hits > 0, 'a change under a subdirectory must fire the watcher')

const afterFirst = hits
writeFileSync(join(root, 'node_modules', 'ignored.js'), 'x\n')
await delay(700)
assert.equal(hits, afterFirst, 'ignored directories must not fire the watcher')

assert.ok(IGNORED.test('src/bin/Debug/x.dll'), 'bin must be ignored')
assert.ok(IGNORED.test('.git/index'), '.git must be ignored')
assert.ok(!IGNORED.test('src/Program.cs'), 'normal sources must not be ignored')

close()
rmSync(root, { recursive: true, force: true })
console.log('ok — fs watch')
