import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { appendJoinedSelectColumns, appendRelatedJoin, buildExplicitSelect, extractSqlBaseTable } from '../src/components/sql/sqlQueryUtils.ts'
import { calculateColumnMetrics, calculateVisibleRange } from '../src/components/sql/sqlGridUtils.ts'
import { layoutSqlDiagram } from '../src/components/sql/sqlDiagramLayout.ts'
import { analyzeSqlCompletionContext, extractSqlAliases, stripSqlCommentsAndStrings } from '../src/components/sql/sqlAssistant.ts'

const fk = {
  table: 'dbo.Child',
  column: 'ParentId',
  referencedTable: 'dbo.Parent',
  referencedColumn: 'Id'
}

const assistantSql = ['SELECT ', 'FROM dbo.MassiveRows AS m', 'JOIN dbo.Parent AS p ON p.Id = m.ParentId'].join('\n')
const assistantContext = analyzeSqlCompletionContext(assistantSql, 'SELECT '.length)
assert.equal(assistantContext.clause, 'select')
assert.deepEqual([...assistantContext.aliases], [['m', 'dbo.MassiveRows'], ['p', 'dbo.Parent']])
assert.deepEqual([...extractSqlAliases("SELECT fake.value FROM dbo.Real AS r -- JOIN dbo.Hidden AS h\nWHERE r.Name = 'FROM dbo.StringTable s'")], [['r', 'dbo.Real']])
assert.equal(stripSqlCommentsAndStrings("SELECT 'JOIN dbo.Nope n' -- FROM x\nFROM dbo.Real r").includes('dbo.Nope'), false)

const explicitSelect = buildExplicitSelect('dbo.Child', ['Id', 'ParentId'], 1000)
assert.match(explicitSelect, /SELECT TOP \(1000\)[\s\S]*\[Child\]\.\[Id\][\s\S]*\[Child\]\.\[ParentId\]/)
assert.doesNotMatch(explicitSelect, /\*/)


const outbound = appendRelatedJoin('SELECT * FROM dbo.Child WHERE IsActive = 1', fk)
assert.equal(outbound.status, 'added')
assert.match(outbound.query, /LEFT JOIN \[dbo\]\.\[Parent\] AS \[fk1\]/)
assert.ok(outbound.query.indexOf('LEFT JOIN') < outbound.query.indexOf('WHERE'))
const projectedJoin = appendJoinedSelectColumns(outbound.query, outbound.alias, outbound.targetTable, ['Id', 'Name'])
assert.match(projectedJoin, /\[fk1\]\.\[Id\] AS \[Parent · fk1\.Id\]/)

const inbound = appendRelatedJoin('SELECT p.Id FROM dbo.Parent AS p;', fk)
assert.equal(inbound.status, 'added')
assert.match(inbound.query, /JOIN \[dbo\]\.\[Child\].*\[fk1\]\.\[ParentId\] = \[p\]\.\[Id\]/s)

const bracketed = extractSqlBaseTable('SELECT * FROM [demo-db].[sales].[Order Lines] WHERE [Id] = 1')
assert.deepEqual(bracketed, { schema: 'sales', table: 'Order Lines', alias: undefined })
assert.equal(appendRelatedJoin(outbound.query, fk).status, 'already-present')

const selfFk = {
  table: 'dbo.Employee',
  column: 'ManagerId',
  referencedTable: 'dbo.Employee',
  referencedColumn: 'Id'
}
const selfJoin = appendRelatedJoin('SELECT e.* FROM dbo.Employee AS e', selfFk)
assert.equal(selfJoin.status, 'added', 'a self-referencing FK must create a self JOIN')
assert.match(selfJoin.query, /JOIN \[dbo\]\.\[Employee\] AS \[fk1\].*\[fk1\]\.\[Id\] = \[e\]\.\[ManagerId\]/s)
assert.equal(appendRelatedJoin(selfJoin.query, selfFk).status, 'already-present', 'the exact self JOIN must not be duplicated')

const createdByFk = {
  table: 'dbo.AuditLog',
  column: 'CreatedById',
  referencedTable: 'dbo.Users',
  referencedColumn: 'Id'
}
const updatedByFk = { ...createdByFk, column: 'UpdatedById' }
const createdByJoin = appendRelatedJoin('SELECT a.* FROM dbo.AuditLog AS a', createdByFk)
assert.equal(createdByJoin.status, 'added')
const bothUserJoins = appendRelatedJoin(createdByJoin.query, updatedByFk)
assert.equal(bothUserJoins.status, 'added', 'a second FK to the same table must use another alias')
assert.match(bothUserJoins.query, /JOIN \[dbo\]\.\[Users\] AS \[fk2\].*\[fk2\]\.\[Id\] = \[a\]\.\[UpdatedById\]/s)
assert.equal(appendRelatedJoin(bothUserJoins.query, updatedByFk).status, 'already-present', 'the second exact relationship must not create fk3')

const column = { name: 'Id', type: 'int', maxLength: null, nullable: false, isPrimaryKey: true, isForeignKey: false, defaultValue: null }
const cyclicData = {
  tables: Array.from({ length: 1000 }, (_, index) => ({ name: `dbo.T${index}`, columns: [column] })),
  edges: Array.from({ length: 1000 }, (_, index) => ({
    constraintName: `FK_${index}`,
    table: `dbo.T${index}`,
    column: 'Id',
    referencedTable: `dbo.T${(index + 1) % 1000}`,
    referencedColumn: 'Id'
  }))
}
const layoutStarted = performance.now()
const layout = layoutSqlDiagram(cyclicData)
const layoutMs = performance.now() - layoutStarted
assert.equal(layout.length, 1000)
assert.ok(layout.every(table => Number.isFinite(table.x) && Number.isFinite(table.y)))
const diagramWidth = Math.max(...layout.map(table => table.x + table.w)) - Math.min(...layout.map(table => table.x))
const diagramHeight = Math.max(...layout.map(table => table.y + table.h)) - Math.min(...layout.map(table => table.y))
assert.ok(diagramWidth / diagramHeight < 4, `cyclic diagram is too wide to navigate: ${diagramWidth}x${diagramHeight}`)
assert.ok(diagramHeight / diagramWidth < 4, `cyclic diagram is too tall to navigate: ${diagramWidth}x${diagramHeight}`)

const range = calculateVisibleRange(250000, 2_500_000, 800, 26, 8)
assert.ok(range.start >= 0 && range.end <= 250000 && range.end - range.start < 60)

const columns = Array.from({ length: 1000 }, (_, index) => `Column${index}`)
const widths = Object.fromEntries(columns.map((name, index) => [name, 80 + index % 160]))
const gridStarted = performance.now()
let checksum = 0
for (let index = 0; index < 10000; index++) {
  const metrics = calculateColumnMetrics(columns, widths, columns.slice(0, 20), 160)
  const visible = calculateVisibleRange(250000, (index * 7919) % 6_000_000, 800, 26, 8)
  checksum += metrics.totalWidth + visible.start
}
const gridMs = performance.now() - gridStarted
assert.ok(checksum > 0)

console.log(JSON.stringify({
  status: 'PASS',
  joinCases: 10,
  cyclicDiagramTables: layout.length,
  cyclicLayoutMs: Number(layoutMs.toFixed(2)),
  cyclicLayoutWidth: Math.round(diagramWidth),
  cyclicLayoutHeight: Math.round(diagramHeight),
  gridIterations: 10000,
  gridColumns: columns.length,
  gridRows: 250000,
  gridMathMs: Number(gridMs.toFixed(2)),
  visibleRows: range.end - range.start
}, null, 2))
