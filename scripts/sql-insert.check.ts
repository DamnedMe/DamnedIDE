// Self-check for the insert-row helpers (guid, date parsing, INSERT building).
// Run: node --experimental-strip-types scripts/sql-insert.check.ts
import assert from 'node:assert/strict'
import {
  buildInsertEntries, buildInsertStatement, formatGridDate, formatSqlDate,
  newGuid, parseDateText, sqlLiteral
} from '../src/components/sql/sqlForm.ts'

// ─── GUID ────────────────────────────────────────────────────────────────────
const g1 = newGuid()
const g2 = newGuid()
assert.match(g1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'v4 uuid shape')
assert.notEqual(g1, g2, 'two generated guids differ')

// ─── date parsing (both the grid format and ISO) ─────────────────────────────
const iso = parseDateText('2026-09-25T10:30:00.123')
assert.ok(iso)
assert.equal(iso!.getFullYear(), 2026)
assert.equal(iso!.getMonth(), 8)
assert.equal(iso!.getDate(), 25)
assert.equal(iso!.getHours(), 10)
assert.equal(iso!.getMilliseconds(), 123)

const grid = parseDateText(formatGridDate(new Date(2026, 8, 25, 10, 30, 0, 5)))
assert.ok(grid, 'the grid format parses back')
assert.equal(grid!.getDate(), 25)
assert.equal(grid!.getHours(), 10)
assert.equal(grid!.getMilliseconds(), 5)

assert.equal(parseDateText('non-una-data'), null, 'garbage is not a date')
assert.equal(parseDateText(''), null)
assert.equal(formatSqlDate(new Date(2026, 0, 2, 3, 4, 5, 6)), '2026-01-02 03:04:05.006')

// sqlLiteral for a date column uses the parsed value, whatever the text format
assert.equal(sqlLiteral('CreatedAt', '25/09/2026 10:30:00.123', { CreatedAt: 'date' }), "'2026-09-25 10:30:00.123'")
assert.equal(sqlLiteral('CreatedAt', '2026-09-25T10:30:00', { CreatedAt: 'date' }), "'2026-09-25 10:30:00.000'")

// ─── insert entries ──────────────────────────────────────────────────────────
const colTypes = { Id: 'guid', Name: 'string', Amount: 'number', Active: 'boolean', CreatedAt: 'date' }
const entries = buildInsertEntries(
  ['Id', 'Name', 'Amount', 'Active', 'CreatedAt', 'Skipped'],
  {
    Id: '0f8fad5b-d9cb-469f-a165-70867728950e',
    Name: "O'Brien",
    Amount: '42',
    Active: 'true',
    CreatedAt: '25/09/2026 10:30:00.123',
    Skipped: '   '
  },
  colTypes
)
assert.deepEqual(entries, [
  { column: 'Id', literal: "N'0f8fad5b-d9cb-469f-a165-70867728950e'" },
  { column: 'Name', literal: "N'O''Brien'" },
  { column: 'Amount', literal: '42' },
  { column: 'Active', literal: '1' },
  { column: 'CreatedAt', literal: "'2026-09-25 10:30:00.123'" }
], 'typed literals, empty cells omitted, quotes escaped')

// explicit NULL is kept, false becomes 0
assert.deepEqual(
  buildInsertEntries(['Name', 'Active'], { Name: 'NULL', Active: 'false' }, colTypes),
  [{ column: 'Name', literal: 'NULL' }, { column: 'Active', literal: '0' }]
)

// ─── statement ───────────────────────────────────────────────────────────────
const statement = buildInsertStatement('dbo.My Table', entries)
assert.ok(statement)
assert.ok(statement!.startsWith('INSERT INTO [dbo].[My Table] ([Id], [Name], [Amount], [Active], [CreatedAt])'), statement!)
assert.ok(statement!.includes("VALUES (N'0f8fad5b-d9cb-469f-a165-70867728950e', N'O''Brien', 42, 1, '2026-09-25 10:30:00.123')"), statement!)
assert.equal(buildInsertStatement('dbo.T', []), null, 'no entries → no statement')
assert.equal(buildInsertStatement('', entries), null, 'no table → no statement')

console.log('ok — sql insert')
