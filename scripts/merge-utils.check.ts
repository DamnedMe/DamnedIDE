// Self-check for the merge tool logic (conflict parsing + per-hunk choices).
// Run: node --experimental-strip-types scripts/merge-utils.check.ts
import assert from 'node:assert/strict'
import { parseConflicts, applyChoices, unresolvedCount, detectLangForMerge } from '../src/components/worktree/merge-utils.ts'

const conflicted = [
  'line1',
  '<<<<<<< HEAD',
  'oursA',
  'oursB',
  '=======',
  'theirsA',
  '>>>>>>> feature/x',
  'line5',
  'line6',
  '<<<<<<< HEAD',
  'o2',
  '=======',
  't2a',
  't2b',
  '>>>>>>> feature/x',
  'tail'
].join('\n')

const blocks = parseConflicts(conflicted)
assert.equal(blocks.length, 2, 'two conflicts parsed')
assert.deepEqual(blocks[0].ours, ['oursA', 'oursB'])
assert.deepEqual(blocks[0].theirs, ['theirsA'])
assert.equal(blocks[0].startLine, 2)
assert.equal(blocks[0].endLine, 7)
assert.equal(blocks[0].oursStart, 3)
assert.equal(blocks[0].theirsStart, 6)
assert.deepEqual(blocks[0].contextBefore, ['line1'])
assert.deepEqual(blocks[0].contextAfter, ['line5', 'line6'])
assert.deepEqual(blocks[1].contextAfter, ['tail'])

// no choices: the file is untouched (markers preserved)
assert.equal(applyChoices(conflicted, blocks, {}), conflicted)
assert.equal(unresolvedCount(blocks, {}), 2)

// take ours on #1: markers replaced, #2 still unresolved
const onlyOurs = applyChoices(conflicted, blocks, { 0: 'ours' })
assert.deepEqual(onlyOurs.split('\n'), [
  'line1', 'oursA', 'oursB', 'line5', 'line6',
  '<<<<<<< HEAD', 'o2', '=======', 't2a', 't2b', '>>>>>>> feature/x', 'tail'
])
assert.equal(unresolvedCount(blocks, { 0: 'ours' }), 1)

// both sides, in order (ours then theirs)
const both = applyChoices(conflicted, blocks, { 0: 'both', 1: 'theirs' })
assert.deepEqual(both.split('\n'), ['line1', 'oursA', 'oursB', 'theirsA', 'line5', 'line6', 't2a', 't2b', 'tail'])
assert.equal(unresolvedCount(blocks, { 0: 'both', 1: 'theirs' }), 0)

// a file without conflicts is returned as-is
assert.equal(parseConflicts('a\nb\n').length, 0)
assert.equal(applyChoices('a\nb', [], {}), 'a\nb')

assert.equal(detectLangForMerge('src/Program.cs'), 'csharp')
assert.equal(detectLangForMerge('README.md'), 'markdown')
assert.equal(detectLangForMerge('unknown.xyz'), 'plaintext')

console.log('ok — merge utils')
