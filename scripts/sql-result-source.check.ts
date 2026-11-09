// Self-check for the result set → statement → table/key mapping behind grid edits.
// Run: node --experimental-strip-types scripts/sql-result-source.check.ts
import assert from 'node:assert/strict'
import {
  buildCellUpdate, buildResultSource, buildRowDelete, canInsertInto, isReadOnlyBatch, mapResultSets,
  resolveColumnEdit, resolveRowTarget, splitSqlBatch, sqlValueLiteral, type SqlDescribedColumn
} from '../src/shared/sqlResultSource.ts'

const kinds = (sql: string) => splitSqlBatch(sql).statements.map(s => s.kind)

// ─── splitting: with and without ';' ─────────────────────────────────────────
assert.deepEqual(kinds('SELECT * FROM A\nSELECT * FROM B'), ['rows', 'rows'], 'two SELECTs without semicolons')
assert.deepEqual(kinds('USE [my]]db];\nSELECT 1;SELECT 2'), ['none', 'rows', 'rows'])
assert.equal(splitSqlBatch('USE [my]]db];\nSELECT 1').statements[1].database, 'my]db', 'USE sets the database of what follows')
assert.deepEqual(kinds('SELECT a FROM A UNION ALL SELECT a FROM B\nSELECT 1'), ['rows', 'rows'], 'UNION continues the statement')
assert.deepEqual(kinds('SELECT x FROM A WHERE x IN (SELECT y FROM B) SELECT 2'), ['rows', 'rows'], 'subqueries stay inside')
assert.deepEqual(kinds('WITH c AS (SELECT * FROM A) SELECT * FROM c\nSELECT 2'), ['rows', 'rows'], 'CTE + its SELECT is one statement')
assert.deepEqual(kinds(';WITH c (x) AS (SELECT 1) UPDATE A SET y = 1 FROM c'), ['write'])
assert.deepEqual(kinds('SELECT * FROM A WITH (NOLOCK) SELECT 2'), ['rows', 'rows'], 'a table hint is not a CTE')
assert.deepEqual(kinds('INSERT INTO A (x) SELECT x FROM B\nSELECT * FROM A'), ['write', 'rows'], 'INSERT … SELECT then a new SELECT')
assert.deepEqual(kinds('INSERT INTO A VALUES (1) SELECT * FROM A'), ['write', 'rows'])
assert.deepEqual(kinds('INSERT INTO A EXEC dbo.p'), ['write'])
assert.deepEqual(kinds('UPDATE A SET x = 1 WHERE id = 2\nSET NOCOUNT ON\nSELECT 1'), ['write', 'none', 'rows'], 'UPDATE … SET then a SET statement')
assert.deepEqual(kinds("SELECT CASE WHEN x = 1 THEN 'a' ELSE 'b' END AS v FROM A SELECT 2"), ['rows', 'rows'], 'CASE … ELSE … END is not a block')
assert.deepEqual(kinds('DECLARE @id INT = 5\nSELECT @id = Id FROM A\nSELECT @id AS v\nSELECT TOP (1) @id += 1 FROM A'), ['none', 'none', 'rows', 'none'], 'variable assignments return nothing')
assert.deepEqual(kinds('SELECT @@ROWCOUNT AS n'), ['rows'])
assert.deepEqual(kinds('SELECT * INTO #t FROM A SELECT * FROM #t'), ['write', 'rows'])
assert.deepEqual(kinds("SELECT ';' AS a, [x;y] FROM A -- SELECT\n/* SELECT /* nested */ SELECT */ SELECT 2"), ['rows', 'rows'], 'strings, brackets and comments are skipped')
assert.deepEqual(kinds('DROP TABLE IF EXISTS #t\nSELECT 1'), ['write', 'rows'], 'DROP … IF EXISTS is one statement')
assert.deepEqual(kinds('BEGIN TRAN\nSELECT 1\nCOMMIT'), ['none', 'rows', 'none'])
assert.deepEqual(kinds('MERGE A AS t USING B AS s ON t.id = s.id WHEN MATCHED THEN UPDATE SET x = s.x WHEN NOT MATCHED THEN INSERT (id) VALUES (s.id);\nSELECT 1'), ['write', 'rows'])
assert.deepEqual(kinds('DECLARE c CURSOR FOR SELECT id FROM A\nSELECT 1'), ['none', 'rows'], 'cursor declaration owns its SELECT')
assert.deepEqual(kinds('SELECT * FROM A ORDER BY id OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY\nSELECT 2'), ['rows', 'rows'], 'OFFSET … FETCH stays in the SELECT')
assert.deepEqual(kinds('GRANT SELECT, INSERT ON A TO u\nSELECT 1'), ['write', 'rows'], 'permissions are not statements')

// stops at the first statement whose result sets cannot be predicted
const stopped = splitSqlBatch("SELECT 1\nEXEC sp_help 'A'\nSELECT 2")
assert.equal(stopped.complete, false)
assert.deepEqual(stopped.statements.map(s => s.kind), ['rows', 'unknown'])
assert.equal(splitSqlBatch('IF 1 = 1 SELECT 1 ELSE SELECT 2').complete, false)
assert.equal(splitSqlBatch('UPDATE A SET x = 1 OUTPUT inserted.*').complete, false, 'OUTPUT can return rows')
assert.equal(splitSqlBatch('SET STATISTICS XML ON\nSELECT 1').complete, false)
assert.equal(splitSqlBatch('CREATE VIEW v AS SELECT 1').complete, false)
assert.equal(splitSqlBatch("sp_help 'A'").complete, false)

// ─── read-only batches can be re-run to refresh the grid ────────────────────
assert.equal(isReadOnlyBatch('USE [db];\nSELECT * FROM A\nSELECT * FROM B'), true)
assert.equal(isReadOnlyBatch('INSERT INTO A VALUES (1)\nSELECT * FROM A'), false)
assert.equal(isReadOnlyBatch('EXEC dbo.p'), false)
assert.equal(isReadOnlyBatch(''), false)

// ─── result set → statement ─────────────────────────────────────────────────
const batch = 'USE [shop];\nDECLARE @c INT = 1\nUPDATE dbo.Log SET n = n + 1\nSELECT * FROM dbo.Orders WHERE CustId = @c\nSELECT * FROM dbo.Customers'
const mapped = mapResultSets(batch, 2)
assert.ok('statement' in mapped[0] && 'statement' in mapped[1])
if ('statement' in mapped[0] && 'statement' in mapped[1]) {
  assert.equal(mapped[0].statement, 'SELECT * FROM dbo.Orders WHERE CustId = @c')
  assert.equal(mapped[0].describe, 'DECLARE @c INT = 1;\nSELECT * FROM dbo.Orders WHERE CustId = @c', 'variables are declared for the describe')
  assert.equal(mapped[0].database, 'shop')
  assert.equal(mapped[1].statement, 'SELECT * FROM dbo.Customers')
}
assert.ok(mapResultSets('SELECT 1\nSELECT 2', 3).every(m => 'blocked' in m), 'a count mismatch blocks every result set')
const partial = mapResultSets("SELECT * FROM A\nEXEC sp_help 'A'", 3)
assert.ok('statement' in partial[0], 'result sets before the EXEC are still mapped')
assert.ok('blocked' in partial[1] && /EXEC/.test(partial[1].blocked))

// ─── description → source → edit targets ────────────────────────────────────
const col = (name: string, table: string | null, column: string | null, key = false, hidden = false, database = 'shop'): SqlDescribedColumn =>
  ({ name, is_hidden: hidden, source_database: table ? database : null, source_schema: table ? 'dbo' : null, source_table: table, source_column: column, is_part_of_unique_key: key })

// SELECT * FROM Orders o JOIN Customers c ON c.Id = o.CustId (both tables have Id and Name)
const joinStar = buildResultSource([
  col('Id', 'Orders', 'Id', true), col('CustId', 'Orders', 'CustId'), col('Name', 'Orders', 'Name'),
  col('Id', 'Customers', 'Id', true), col('Name', 'Customers', 'Name'), col('Code', 'Customers', 'Code')
], ['Id', 'CustId', 'Name', 'Code'], { baseTable: 'dbo.Orders', database: 'shop' })
assert.equal(joinStar.table, 'dbo.Orders')
const row = { Id: [10, 1], CustId: 1, Name: ['o10', 'c1'], Code: "C'1" }

const custId = resolveColumnEdit(joinStar, 'CustId')
assert.ok(custId.ok)
if (custId.ok) {
  assert.equal(buildCellUpdate(custId.target, row, '2'), 'UPDATE [dbo].[Orders]\nSET [CustId] = 2\nWHERE [Id] = 10', 'the key value is the Orders occurrence of Id')
}
const code = resolveColumnEdit(joinStar, 'Code')
assert.ok(code.ok)
if (code.ok) assert.equal(buildCellUpdate(code.target, row, "N'X'"), "UPDATE [dbo].[Customers]\nSET [Code] = N'X'\nWHERE [Id] = 1", 'a joined column writes to its own table and key')
const shared = resolveColumnEdit(joinStar, 'Name')
assert.ok(!shared.ok && /più colonne si chiamano «Name»/.test(shared.reason), 'two tables share the column name')

const del = resolveRowTarget(joinStar)
assert.ok(del.ok)
if (del.ok) assert.equal(buildRowDelete(del.target, row), 'DELETE FROM [dbo].[Orders]\nWHERE [Id] = 10')
assert.equal(canInsertInto(joinStar), false, 'no insert into a joined result')

// SELECT o.Name, c.Name AS CName …: aliases map back, hidden keys are not usable
const hiddenKeys = buildResultSource([
  col('Name', 'Orders', 'Name'), col('CName', 'Customers', 'Name'), col('Id', 'Orders', 'Id', true, true), col('Id', 'Customers', 'Id', true, true)
], ['Name', 'CName'])
const cname = resolveColumnEdit(hiddenKeys, 'CName')
assert.ok(!cname.ok && /aggiungi alla SELECT la chiave di dbo.Customers \(Id\)/.test(cname.reason))

// aliased key + expression + table without key + self join
const aliased = buildResultSource([col('OrderId', 'Orders', 'Id', true), col('Label', 'Orders', 'Name'), col('X', null, null)], ['OrderId', 'Label', 'X'], { baseTable: 'dbo.Orders' })
const label = resolveColumnEdit(aliased, 'Label')
assert.ok(label.ok)
if (label.ok) assert.equal(buildCellUpdate(label.target, { OrderId: 7, Label: 'a', X: 1 }, "N'b'"), "UPDATE [dbo].[Orders]\nSET [Name] = N'b'\nWHERE [Id] = 7")
const expr = resolveColumnEdit(aliased, 'X')
assert.ok(!expr.ok && /valore calcolato/.test(expr.reason))
assert.equal(canInsertInto(aliased), false, 'aliases and expressions block insert')
const noKey = resolveColumnEdit(buildResultSource([col('A', 'NoKey', 'A')], ['A']), 'A')
assert.ok(!noKey.ok && /non ha una chiave primaria o univoca/.test(noKey.reason))
const selfJoin = buildResultSource([col('Id', 'Emp', 'Id', true), col('Boss', 'Emp', 'Name'), col('Id', 'Emp', 'Id', true, true)], ['Id', 'Boss'])
const boss = resolveColumnEdit(selfJoin, 'Boss')
assert.ok(!boss.ok && /compare più volte/.test(boss.reason))

// another database is kept in the target name; the base table must be a real source
const cross = buildResultSource([col('Id', 'T', 'Id', true, false, 'other')], ['Id'], { baseTable: 'dbo.Missing', database: 'shop' })
assert.equal(cross.columns?.[0].table, 'other.dbo.T')
assert.equal(cross.table, undefined)
assert.ok(!resolveRowTarget(cross).ok)

// a description that does not match the grid blocks everything
const mismatch = buildResultSource([col('Id', 'T', 'Id', true)], ['Other'])
assert.ok(mismatch.blocked && !resolveColumnEdit(mismatch, 'Other').ok)
assert.ok(!resolveColumnEdit(undefined, 'Id').ok, 'no source, no edit')
assert.equal((resolveColumnEdit({ blocked: 'motivo' }, 'Id') as { reason: string }).reason, 'motivo')

// single table: insert allowed
assert.equal(canInsertInto(buildResultSource([col('Id', 'T', 'Id', true), col('Name', 'T', 'Name')], ['Id', 'Name'], { baseTable: 'dbo.T' })), true)

// ─── key literals ───────────────────────────────────────────────────────────
assert.equal(sqlValueLiteral(null), 'NULL')
assert.equal(sqlValueLiteral(12n), '12')
assert.equal(sqlValueLiteral(true), '1')
assert.equal(sqlValueLiteral("O'Brien"), "N'O''Brien'")
assert.equal(sqlValueLiteral(new Date(Date.UTC(2026, 0, 5, 10, 30, 0, 7))), "'2026-01-05T10:30:00.007'")
assert.equal(sqlValueLiteral(new Uint8Array([0, 255])), '0x00ff')
const nullKey = resolveColumnEdit(buildResultSource([col('Code', 'T', 'Code', true), col('V', 'T', 'V')], ['Code', 'V']), 'V')
if (nullKey.ok) assert.equal(buildCellUpdate(nullKey.target, { Code: null, V: 1 }, '2'), 'UPDATE [dbo].[T]\nSET [V] = 2\nWHERE [Code] IS NULL')

console.log('sql-result-source: ok')
