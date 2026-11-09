// Self-check for the result-grid export writers and copy text.
// Run: node --experimental-strip-types scripts/sql-export.check.ts
import assert from 'node:assert/strict'
import { columnText, formatCell, toCsv, toSqlScript, toTextTable, toTextTables, xlsxRows, type ExportSet } from '../src/components/sql/sqlExport.ts'

const orders: ExportSet = {
  title: 'Result set 1',
  table: 'dbo.Orders',
  columns: ['Id', 'Name', 'Notes'],
  rows: [
    { Id: 10, Name: 'o10', Notes: null },
    { Id: 7, Name: 'pipe | and\nnewline', Notes: 'x' }
  ],
  colTypes: { Id: 'number', Name: 'string', Notes: 'string' }
}

// ─── aligned text table (Markdown-compatible) ────────────────────────────────
assert.equal(toTextTable(orders), [
  '|  Id | Name                | Notes |',
  '|----:|---------------------|-------|',
  '|  10 | o10                 | NULL  |',
  '|   7 | pipe \\| and newline | x     |'
].join('\n'), 'padded columns, numbers right-aligned, pipes escaped, one line per row')
const lines = toTextTable(orders).split('\n')
assert.ok(lines.every(line => line.length === lines[0].length), 'every line has the same width')
assert.equal(toTextTable({ ...orders, rows: [{ Id: 1, Name: 'y'.repeat(200), Notes: null }] }).split('\n')[2].includes('…'), true, 'long cells are cut')

const customers: ExportSet = { title: 'Result set 2', columns: ['Code'], rows: [{ Code: 'C1' }], colTypes: {} }
assert.equal(toTextTables([orders]), toTextTable(orders), 'a single set has no heading')
const both = toTextTables([orders, customers])
assert.ok(both.startsWith('Result set 1 · dbo.Orders · 2 righe\n|  Id |'), 'one heading per set')
assert.ok(both.includes('\n\nResult set 2 · 1 riga\n| Code |'), 'blocks are separated by a blank line')

// ─── grid formatting and copy text ──────────────────────────────────────────
assert.equal(formatCell(null), 'NULL')
assert.equal(formatCell(new Date(2026, 0, 2, 3, 4, 5, 6), 'date'), '02/01/2026 03:04:05.00600')
assert.equal(formatCell(12.5, 'number'), '12.5')
assert.equal(columnText(orders.rows, 'Name', orders.colTypes), 'o10\npipe | and newline', 'one value per line, newlines flattened')
assert.equal(columnText(orders.rows, 'Notes', orders.colTypes), 'NULL\nx')

// ─── existing writers, now shared by single and multi-set export ────────────
assert.equal(toCsv(['a', 'b'], [{ a: 'x,y', b: null }]), 'a,b\r\n"x,y",')
assert.equal(toSqlScript(customers), "-- select a table (FROM clause) to get the real table name\nINSERT INTO [result] ([Code])\nVALUES\n(N'C1');")
assert.ok(toSqlScript(orders).startsWith('-- 2 rows from [dbo].[Orders]\nINSERT INTO [dbo].[Orders] ([Id], [Name], [Notes])'))
assert.deepEqual(xlsxRows({ ...orders, rows: [{ Id: 10n, Name: true, Notes: null }] }), [[10, true, null]])

console.log('sql-export: ok')
