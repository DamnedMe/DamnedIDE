const { SqlService, buildConnectionString, parseConnectionString } = require('C:/Users/loren/Documents/Projects/DamnedIDE/electron/services/sql/sql.service.ts')

let failures = 0
const check = (name, cond, extra) => {
  if (!cond) { failures++; console.log(`FAIL: ${name}`, extra ?? '') }
  else console.log(`ok: ${name}`)
}

async function main() {
  const svc = new SqlService()
  const server = '(localdb)\\Local'
  const cfg = { server, authType: 'sql', encrypt: false }

  // 1) testConnection (pipe path)
  const t = await svc.testConnection(cfg)
  check('testConnection ok', t.ok === true, JSON.stringify(t))
  check('testConnection version', !!t.version && t.version.includes('Microsoft SQL Server'), t.version)

  // 2) connect (named pipe, `(localdb)\Local` → instance "Local")
  const connId = await svc.connect({ ...cfg, connectionId: 'itest' })
  check('connect ok', !!connId)

  // 3) create a test database with schema (FK + view + procedure)
  const testDb = 'damnedide_itest'
  await svc.executeQuery(connId, `
    IF DB_ID('${testDb}') IS NULL CREATE DATABASE [${testDb}]
    IF OBJECT_ID('${testDb}.dbo.Parent', 'U') IS NULL BEGIN
      EXEC('CREATE TABLE [${testDb}].dbo.Parent (Id INT NOT NULL PRIMARY KEY, Name NVARCHAR(50) NULL)')
      EXEC('CREATE TABLE [${testDb}].dbo.Child (Id INT NOT NULL PRIMARY KEY, ParentId INT NOT NULL, Amount DECIMAL(10,2) NULL, CreatedAt DATETIME2 NULL,
            CONSTRAINT FK_Child_Parent FOREIGN KEY (ParentId) REFERENCES [${testDb}].dbo.Parent(Id))')
    END
    IF NOT EXISTS (SELECT 1 FROM [${testDb}].dbo.Parent)
    BEGIN
      INSERT INTO [${testDb}].dbo.Parent (Id, Name) VALUES (1, N'First'), (2, N'Second')
    END
    -- idempotent: reset Child rows from any previous run
    DELETE FROM [${testDb}].dbo.Child
    INSERT INTO [${testDb}].dbo.Child (Id, ParentId, Amount, CreatedAt) VALUES (1, 1, 10.5, '2026-01-05T10:30:00'), (2, 1, 20, '2026-02-01T00:00:00')`)
  // CREATE VIEW/PROCEDURE must be the first statement of the batch → use a pool
  // whose default database is the test db.
  const conn2 = await svc.connect({ ...cfg, database: testDb, connectionId: 'itest2' })
  await svc.executeQuery(conn2, `IF OBJECT_ID('dbo.vChild', 'V') IS NOT NULL DROP VIEW dbo.vChild`)
  await svc.executeQuery(conn2, `IF OBJECT_ID('dbo.spHello', 'P') IS NOT NULL DROP PROCEDURE dbo.spHello`)
  await svc.executeQuery(conn2,
    `CREATE VIEW dbo.vChild AS SELECT c.Id, c.ParentId, p.Name AS ParentName FROM dbo.Child c JOIN dbo.Parent p ON p.Id = c.ParentId`)
  await svc.executeQuery(conn2,
    `CREATE PROCEDURE dbo.spHello AS SELECT 1 AS One`)
  await svc.disconnect(conn2)

  // 4) databases include the test db (db name with no special chars here; hyphen case covered below)
  const dbs = await svc.listDatabases(connId)
  check('listDatabases contains test db', dbs.includes(testDb), JSON.stringify(dbs))

  // 5) hyphenated database name (regression for "Incorrect syntax near '-'")
  const hypDb = 'themis-db'
  await svc.executeQuery(connId, `IF DB_ID('${hypDb}') IS NULL CREATE DATABASE [${hypDb}]`)
  const tablesHyp = await svc.listTables(connId, hypDb)
  check('listTables on hyphen db (bracketed)', Array.isArray(tablesHyp), JSON.stringify(tablesHyp))

  // 6) tables / views / procedures / functions on the real db
  const tables = await svc.listTables(connId, testDb)
  check('listTables', tables.includes('dbo.Parent') && tables.includes('dbo.Child'), JSON.stringify(tables))
  const views = await svc.listViews(connId, testDb)
  check('listViews', views.includes('dbo.vChild'), JSON.stringify(views))
  const procs = await svc.listStoredProcedures(connId, testDb)
  check('listStoredProcedures', procs.includes('dbo.spHello'), JSON.stringify(procs))
  const funcs = await svc.listFunctions(connId, testDb)
  check('listFunctions empty ok', Array.isArray(funcs), JSON.stringify(funcs))

  // 7) columns with PK/FK flags
  const cols = await svc.listColumns(connId, testDb, 'dbo.Child')
  const colMap = Object.fromEntries(cols.map(c => [c.name, c]))
  check('columns count', cols.length >= 4, JSON.stringify(cols.map(c => c.name)))
  check('column PK flag', colMap.Id?.isPrimaryKey === true, JSON.stringify(colMap.Id))
  check('column FK flag', colMap.ParentId?.isForeignKey === true, JSON.stringify(colMap.ParentId))
  check('column type+nullable', colMap.Amount?.type.startsWith('decimal') === true && colMap.Amount?.nullable === true, JSON.stringify(colMap.Amount))

  // 8) diagram: tables + FK edges
  const diagram = await svc.getDiagram(connId, testDb, ['dbo.Parent', 'dbo.Child'])
  check('diagram tables', diagram.tables.length === 2, JSON.stringify(diagram.tables.map(t => t.name)))
  check('diagram edge', diagram.edges.some(e => e.table === 'dbo.Child' && e.referencedTable === 'dbo.Parent' && e.column === 'ParentId'), JSON.stringify(diagram.edges))

  // 9) executeQuery: multi-result + row data + rowCount
  const exec = await svc.executeQuery(connId, 'SELECT TOP 10 Id, Name FROM [damnedide_itest].dbo.Parent; SELECT Id, ParentId FROM [damnedide_itest].dbo.Child', undefined, 100)
  check('multi-result sets', exec.results.length === 2, `results=${exec.results.length}`)
  check('first set rows', exec.results[0].rows.length === 2 && exec.results[0].rowCount === 2, JSON.stringify(exec.results[0].rows))
  check('second set rows', exec.results[1].rows.length === 2, JSON.stringify(exec.results[1].rows))
  check('elapsedMs present', typeof exec.elapsedMs === 'number' && exec.elapsedMs >= 0)
  check('colTypes sniffed', exec.results[0].colTypes?.Id === 'number', JSON.stringify(exec.results[0].colTypes))
  check('date type', exec.results[1].colTypes?.ParentId === 'number', '')

  // 10) PK/FK enrichment (query prefixed with USE like the app; database pinned for metadata)
  const exec2 = await svc.executeQuery(connId, `USE [${testDb}]; SELECT * FROM dbo.Child`, undefined, 100, testDb)
  check('pk enrichment', exec2.results[0].primaryKeys?.includes('Id'), JSON.stringify(exec2.results[0].primaryKeys))
  check('fk enrichment', exec2.results[0].foreignKeys?.includes('ParentId'), JSON.stringify(exec2.results[0].foreignKeys))
  check('fk join info', exec2.results[0].foreignKeyInfo?.some(f => f.table === 'dbo.Child' && f.referencedTable === 'dbo.Parent'), JSON.stringify(exec2.results[0].foreignKeyInfo))

  // 11) DML rowsAffected
  const dml = await svc.executeQuery(connId, 'UPDATE [damnedide_itest].dbo.Parent SET Name = N\'Updated\' WHERE Id = 1')
  check('dml rowsAffected', dml.rowsAffected[0] === 1, JSON.stringify(dml.rowsAffected))

  // 12) objectDefinition (view script)
  const viewDef = await svc.objectDefinition(connId, testDb, 'dbo.vChild')
  check('view definition', viewDef.toUpperCase().includes('CREATE VIEW'), viewDef.slice(0, 80))

  // 13) truncation at maxRows
  await svc.executeQuery(connId, `DELETE FROM [${testDb}].dbo.Child; INSERT INTO [${testDb}].dbo.Child (Id, ParentId) SELECT TOP 5000 n, 1 FROM (SELECT ROW_NUMBER() OVER (ORDER BY (SELECT 1)) n FROM sys.all_columns) t`)
  const big = await svc.executeQuery(connId, 'SELECT Id FROM [damnedide_itest].dbo.Child', undefined, 100)
  check('truncation', big.truncated === true && big.results[0].rows.length === 100, `rows=${big.results[0].rows.length}`)

  // 14) connection string round trip through the same module
  const cs = buildConnectionString({ server: 'localhost', database: testDb, user: 'sa', password: 'p@ss;w', authType: 'sql' })
  const parsed = parseConnectionString(cs)
  check('cs round trip', parsed.server === 'localhost' && parsed.database === testDb && parsed.password === 'p@ss;w' && parsed.authType === 'sql', JSON.stringify(parsed))

  // 15) serverInfo (the pool may hand any connection — database is the session context)
  const info = await svc.getServerInfo(connId)
  check('serverInfo', info.server.length > 0 && info.version.includes('Microsoft SQL Server'), JSON.stringify(info))

  // cleanup: close every pool first (frees sessions inside the db), then reset the
  // leftover single-user state (crashed runs) and drop from a master connection.
  await svc.disconnect(connId)
  const cleanupConn = await svc.connect({ ...cfg, connectionId: 'itest_cleanup' })
  await svc.executeQuery(cleanupConn, `IF DB_ID('${hypDb}') IS NOT NULL BEGIN ALTER DATABASE [${hypDb}] SET MULTI_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${hypDb}] END`)
  await svc.executeQuery(cleanupConn, `IF DB_ID('${testDb}') IS NOT NULL BEGIN ALTER DATABASE [${testDb}] SET MULTI_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${testDb}] END`)
  await svc.disconnect(cleanupConn)

  console.log(failures === 0 ? '\nALL PASS — integration test completo' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error('FATAL:', e); process.exit(2) })


