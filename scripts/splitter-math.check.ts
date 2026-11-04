// Self-check for the splitter drag math (clamp + drag-to-collapse threshold).
// Run: node --experimental-strip-types scripts/splitter-math.check.ts
import assert from 'node:assert/strict'
import { dragSplitSize } from '../src/components/layout/splitter-math.ts'

// the worktree splitter: min 180, max 600, collapsible
const wt = { minSize: 180, maxSize: 600, containerSize: 1200, collapsible: true }

assert.deepEqual(dragSplitSize(200, wt), { size: 200, collapse: false }, 'free drag inside the range')
assert.deepEqual(dragSplitSize(150, wt), { size: 180, collapse: false }, 'between min and threshold: pinned at min')
assert.deepEqual(dragSplitSize(90, wt), { size: 180, collapse: false }, 'exactly at the default threshold (min/2): still open')
assert.equal(dragSplitSize(89, wt).collapse, true, 'past the default threshold: collapses')
assert.equal(dragSplitSize(-50, wt).collapse, true, 'dragged past the left edge: collapses')

// not collapsible (every other splitter): same clamp, never collapses
assert.deepEqual(dragSplitSize(80, { ...wt, collapsible: false }), { size: 180, collapse: false }, 'opt-in only')

// custom threshold
assert.equal(dragSplitSize(110, { ...wt, collapseAt: 120 }).collapse, true, 'collapseAt overrides min/2')
assert.equal(dragSplitSize(130, { ...wt, collapseAt: 120 }).collapse, false)

// maxSize and container clamps are kept
assert.deepEqual(dragSplitSize(900, wt), { size: 600, collapse: false }, 'maxSize clamp')
assert.deepEqual(dragSplitSize(900, { ...wt, maxSize: undefined, containerSize: 700 }), { size: 660, collapse: false }, 'container - 40 clamp')
assert.deepEqual(dragSplitSize(300, { ...wt, containerSize: 300 }), { size: 260, collapse: false }, 'container wins over minSize')

// odd minSize rounds the default threshold
assert.equal(dragSplitSize(75, { minSize: 151, containerSize: 800, collapsible: true }).collapse, true)
assert.equal(dragSplitSize(76, { minSize: 151, containerSize: 800, collapsible: true }).collapse, false)

console.log('splitter-math: ok')
