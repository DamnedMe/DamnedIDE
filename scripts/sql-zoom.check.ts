// Self-check for the SQL workbench per-section zoom math (Ctrl+wheel / Ctrl+0).
// Run: node --experimental-strip-types scripts/sql-zoom.check.ts
import assert from 'node:assert/strict'
import {
  clampSqlZoom, normalizeSqlZoom, sqlZoomBounds, stepSqlZoom
} from '../src/components/sql/sqlZoom.ts'
import { uiTextScale } from '../src/utils/fonts.ts'

// ─── bounds: the zoomed font stays inside 8..32px, 100% always allowed ───────
assert.deepEqual(sqlZoomBounds(20), { min: 0.4, max: 1.6 }, 'default IDE font size 20')
assert.deepEqual(sqlZoomBounds(12.5), { min: 0.64, max: 2.56 })
assert.deepEqual(sqlZoomBounds(40), { min: 0.2, max: 1 }, 'a font above 32px can still return to 100%')
assert.deepEqual(sqlZoomBounds(6), { min: 1, max: 32 / 6 }, 'a font below 8px can still return to 100%')

// ─── steps ───────────────────────────────────────────────────────────────────
const b20 = sqlZoomBounds(20)
assert.equal(stepSqlZoom(1, 1, b20), 1.1, 'one step in')
assert.equal(stepSqlZoom(1, -1, b20), 0.909, 'one step out')
assert.equal(stepSqlZoom(1.6, 1, b20), 1.6, 'clamped at the max')
assert.equal(stepSqlZoom(0.4, -1, b20), 0.4, 'clamped at the min')
assert.equal(stepSqlZoom(1.5, 1, b20), 1.6, 'a step past the max lands on the max')

// stepping in and back out returns exactly to 100% (no float drift)
let zoom = 1
for (let i = 0; i < 4; i++) zoom = stepSqlZoom(zoom, 1, b20)
for (let i = 0; i < 4; i++) zoom = stepSqlZoom(zoom, -1, b20)
assert.equal(zoom, 1, 'four in, four out')
for (let i = 0; i < 3; i++) zoom = stepSqlZoom(zoom, -1, b20)
for (let i = 0; i < 3; i++) zoom = stepSqlZoom(zoom, 1, b20)
assert.equal(zoom, 1, 'three out, three in')

// a zoom saved with a smaller IDE font is clamped to the current bounds
assert.equal(clampSqlZoom(2.56, b20), 1.6)
assert.equal(clampSqlZoom(0.1, b20), 0.4)
assert.equal(clampSqlZoom(1.2, b20), 1.2)

// ─── persisted values ────────────────────────────────────────────────────────
assert.equal(normalizeSqlZoom('x'), 1)
assert.equal(normalizeSqlZoom(-2), 1)
assert.equal(normalizeSqlZoom(0), 1)
assert.equal(normalizeSqlZoom(Number.NaN), 1)
assert.equal(normalizeSqlZoom(Number.POSITIVE_INFINITY), 1)
assert.equal(normalizeSqlZoom(undefined), 1)
assert.equal(normalizeSqlZoom(1.331), 1.331)

// ─── base text scale (--ui-text-scale) shared by App and the section zoom ────
assert.equal(uiTextScale(20), 1.6)
assert.equal(uiTextScale(12.5), 1)
assert.equal(uiTextScale(1), 0.5, 'clamped low')
assert.equal(uiTextScale(100), 2.4, 'clamped high')

console.log('sql-zoom: all checks passed')
