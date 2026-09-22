// Self-check for "Open with DamnedIDE" argv resolution.
// Run: node --experimental-strip-types scripts/open-target.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveOpenTarget, openTargetFromArgv } from '../electron/services/open/open-target.ts'

const root = mkdtempSync(join(tmpdir(), 'damned-open-'))
const file = join(root, 'notes.md')
writeFileSync(file, '# hello\n')

assert.equal(resolveOpenTarget(root)?.isDirectory, true, 'a folder resolves as directory')
assert.equal(resolveOpenTarget(file)?.isDirectory, false, 'a file resolves as file')
assert.equal(resolveOpenTarget(join(root, 'missing.md')), null, 'a missing path resolves to null')

const packaged = { packaged: true, appPath: 'C:\\Program Files\\DamnedIDE\\DamnedIDE.exe' }
assert.equal(openTargetFromArgv(['C:\\...\\DamnedIDE.exe', root], packaged)?.path, root, 'folder argument is opened')
assert.equal(openTargetFromArgv(['C:\\...\\DamnedIDE.exe', '--some-flag', file], packaged)?.path, file, 'flags are skipped')
assert.equal(openTargetFromArgv(['C:\\...\\DamnedIDE.exe', packaged.appPath, file], packaged)?.path, file, 'the exe path itself is skipped')

const dev = { packaged: false, appPath: 'C:\\Source\\Repos\\DamnedIDE' }
assert.equal(openTargetFromArgv(['electron.exe', '.'], dev), null, 'dev startup does not open the project folder')
assert.equal(openTargetFromArgv(['electron.exe', '--open', file], dev)?.path, file, '--open works in dev')

rmSync(root, { recursive: true, force: true })
console.log('ok — open target')
