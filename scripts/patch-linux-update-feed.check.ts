// Self-check for the Linux update feed patcher: the .pacman entry must be
// appended (or replaced) in latest-linux.yml without touching the others.
// Run: node --experimental-strip-types scripts/patch-linux-update-feed.check.ts
import assert from 'node:assert/strict'
import { withPacmanEntry } from './patch-linux-update-feed.mjs'

const feed = [
  'version: 0.0.18',
  'files:',
  '  - url: DamnedIDE-0.0.18.AppImage',
  '    sha512: AAA=',
  '    size: 100',
  '    blockMapSize: 10',
  '  - url: damned-ide_0.0.18_amd64.deb',
  '    sha512: BBB=',
  '    size: 200',
  "path: DamnedIDE-0.0.18.AppImage",
  "sha512: AAA=",
  "releaseDate: '2026-10-01T00:00:00.000Z'"
].join('\n')

const patched = withPacmanEntry(feed, { url: 'damned-ide-0.0.18.pacman', sha512: 'CCC=', size: 300 })
const lines = patched.split('\n')
const pacmanAt = lines.findIndex(line => line.includes('.pacman'))
assert.ok(pacmanAt > 0, 'voce pacman presente')
assert.equal(lines[pacmanAt], '  - url: damned-ide-0.0.18.pacman')
assert.equal(lines[pacmanAt + 1], '    sha512: CCC=')
assert.equal(lines[pacmanAt + 2], '    size: 300')
// it goes after the last packaged file, before the top-level keys
assert.ok(lines.indexOf('  - url: damned-ide_0.0.18_amd64.deb') < pacmanAt)
assert.ok(pacmanAt < lines.findIndex(line => line.startsWith('path:')))
// the other entries and the top-level keys are untouched
assert.equal(lines.filter(line => line.includes('DamnedIDE-0.0.18.AppImage')).length, 2)
assert.equal(lines.filter(line => line.includes('sha512: AAA=')).length, 2)
assert.ok(patched.includes("releaseDate: '2026-10-01T00:00:00.000Z'"))

// idempotent: patching again replaces the existing entry instead of duplicating
const again = withPacmanEntry(patched, { url: 'damned-ide-0.0.18.pacman', sha512: 'DDD=', size: 301 })
assert.equal(again.split('\n').filter(line => line.includes('.pacman')).length, 1)
assert.ok(again.includes('sha512: DDD='))
assert.ok(again.includes('size: 301'))

console.log('ok — linux update feed')
