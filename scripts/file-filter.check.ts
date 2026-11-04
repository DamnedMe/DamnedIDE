// Self-check for compileFileFilter (file trees and Worktree > Changes filter).
// Run: node --experimental-strip-types scripts/file-filter.check.ts
import assert from 'node:assert/strict'
import { compileFileFilter, matchPathOrName } from '../src/utils/file-filter.ts'
import type { FileFilter, FileFilterMode } from '../src/utils/file-filter.ts'

const f = (query: string, mode: FileFilterMode = 'regex', extra: Partial<FileFilter> = {}) =>
  compileFileFilter({ query, mode, caseSensitive: false, spaceSensitive: false, ...extra })

// no filter / empty query -> everything matches
assert.equal(compileFileFilter(null)('anything'), true, 'null filter matches all')
assert.equal(f('')('src/a.cs'), true, 'empty query matches all')
assert.equal(f('   ')('src/a.cs'), true, 'blank query matches all')

// regex: unanchored, case-insensitive by default, on the full relative path
assert.equal(f('controller\\.cs$')('src/Api/FooController.cs'), true, 'regex end anchor, case-insensitive')
assert.equal(f('controller\\.cs$')('src/Api/FooController.cs.bak'), false, 'regex end anchor rejects')
assert.equal(f('^src/Api/')('src/Api/FooController.cs'), true, 'regex folder prefix')

// Worktree > Changes: the name alone or the whole path
assert.equal(matchPathOrName(f('^Foo'))('src/Api/FooController.cs'), true, 'anchored on the file name')
assert.equal(matchPathOrName(f('^src/Api/'))('src/Api/FooController.cs'), true, 'anchored on the path')
assert.equal(matchPathOrName(f('^Bar'))('src/Api/FooController.cs'), false, 'neither matches')
assert.equal(matchPathOrName(f('Foo', 'startsWith'))('src/Api/FooController.cs'), true, 'startsWith on the file name')
assert.equal(matchPathOrName(f('^Root'))('Root.cs'), true, 'file at the repo root')
assert.equal(f('^src/Api/')('tests/src/Api/X.cs'), false, 'regex start anchor rejects')
assert.equal(f('Migrations/')('src/Data/Migrations/001.cs'), true, 'regex unanchored folder')
// uppercase escapes keep their meaning (the old code lowercased \S into \s)
assert.equal(f('\\S+Service')('src/FooService.cs'), true, '\\S not lowercased')
assert.equal(f('^\\D+$')('src/abc.cs'), true, '\\D not lowercased')
assert.equal(f('^\\D+$')('src/a1.cs'), false, '\\D rejects a digit')
// case sensitive regex
assert.equal(f('controller', 'regex', { caseSensitive: true })('FooController.cs'), false, 'case-sensitive regex rejects')
assert.equal(f('Controller', 'regex', { caseSensitive: true })('FooController.cs'), true, 'case-sensitive regex accepts')
// invalid regex falls back to substring
assert.equal(f('[')('src/[weird].cs'), true, 'invalid regex -> substring hit')
assert.equal(f('[')('src/plain.cs'), false, 'invalid regex -> substring miss')
assert.equal(f('(')('src/(x).cs'), true, 'invalid regex ( -> substring')
// the compiled matcher is reusable (no global-flag lastIndex state)
const m = f('\\.cs$')
assert.equal(m('a.cs'), true)
assert.equal(m('b.cs'), true, 'matcher is stateless across calls')

// startsWith / like as in FileTree
assert.equal(f('foo', 'startsWith')('FooController.cs'), true, 'startsWith case-insensitive')
assert.equal(f('ctrl', 'startsWith')('FooCtrl.cs'), false, 'startsWith rejects middle')
assert.equal(f('ctrl', 'like')('FooCtrl.cs'), true, 'like = contains')
assert.equal(f('Ctrl', 'like', { caseSensitive: true })('Fooctrl.cs'), false, 'like case-sensitive rejects')

// spaces dropped unless spaceSensitive
assert.equal(f('with space', 'like')('src/withspace.cs'), true, 'spaces ignored by default')
assert.equal(f('with space', 'like')('src/with space.cs'), true, 'spaces ignored on target too')
assert.equal(f('with space', 'like', { spaceSensitive: true })('src/withspace.cs'), false, 'spaceSensitive keeps spaces')
assert.equal(f('with space', 'like', { spaceSensitive: true })('src/with space.cs'), true, 'spaceSensitive exact')
assert.equal(f('with space', 'regex')('src/with space.cs'), true, 'regex ignores spaces by default')

console.log('ok — file filter')
