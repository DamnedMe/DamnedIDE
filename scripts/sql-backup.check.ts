// Self-check for the backup / data-tier helpers.
// Run: node --experimental-strip-types scripts/sql-backup.check.ts
import assert from 'node:assert/strict'
import {
  buildBackupStatement, buildFileListStatement, buildRestoreStatement, dataTierArgs, dataTierTargetName,
  defaultBackupFileName, joinServerPath, suggestedImportDatabaseName
} from '../src/shared/sqlBackup.ts'

const date = new Date(2026, 8, 25, 10, 30, 5)

// ─── BACKUP statement ────────────────────────────────────────────────────────
const statement = buildBackupStatement('My-DB', {
  path: 'C:\\backup\\My-DB_2026.bak',
  compress: true,
  copyOnly: false,
  init: true
})
assert.ok(statement.startsWith('BACKUP DATABASE [My-DB]'), statement)
assert.ok(statement.includes("TO DISK = N'C:\\backup\\My-DB_2026.bak'"), statement)
assert.ok(statement.includes('WITH STATS = 10, COMPRESSION, INIT'), statement)

// embedded ] and ' are escaped; options are optional
const quoted = buildBackupStatement('we]ird', { path: "D:\\it's.bak", compress: false, copyOnly: true, init: false })
assert.ok(quoted.includes('[we]]ird]'), quoted)
assert.ok(quoted.includes("N'D:\\it''s.bak'"), quoted)
assert.ok(quoted.includes('WITH STATS = 10, COPY_ONLY'), quoted)

// ─── file names ──────────────────────────────────────────────────────────────
assert.equal(defaultBackupFileName('Themis', date), 'Themis_20260925_103005.bak')
assert.equal(dataTierTargetName('Themis', 'extract', date), 'Themis_20260925_103005.dacpac')
assert.equal(dataTierTargetName('Themis', 'export', date), 'Themis_20260925_103005.bacpac')

// ─── server path join ────────────────────────────────────────────────────────
assert.equal(joinServerPath('C:\\Backup\\', 'db.bak'), 'C:\\Backup\\db.bak')
assert.equal(joinServerPath('/var/opt/mssql/backup', 'db.bak'), '/var/opt/mssql/backup/db.bak')

// ─── SqlPackage args ─────────────────────────────────────────────────────────
assert.deepEqual(dataTierArgs('extract', 'Server=.;Database=X;', 'C:\\t\\x.dacpac'), [
  '/Action:Extract',
  '/SourceConnectionString:Server=.;Database=X;',
  '/TargetFile:C:\\t\\x.dacpac',
  '/p:VerifyExtraction=True'
])
assert.deepEqual(dataTierArgs('export', 'cs', 'C:\\t\\x.bacpac'), [
  '/Action:Export',
  '/SourceConnectionString:cs',
  '/TargetFile:C:\\t\\x.bacpac',
  '/p:VerifyExtraction=True'
])

// Import: the .bacpac is the source, the target database is created through the
// connection string (which must not carry a catalog) + /TargetDatabaseName.
assert.deepEqual(dataTierArgs('import', 'Server=.;', 'C:\\t\\x.bacpac', 'NewDb'), [
  '/Action:Import',
  '/SourceFile:C:\\t\\x.bacpac',
  '/TargetConnectionString:Server=.;',
  '/TargetDatabaseName:NewDb'
])
assert.equal(suggestedImportDatabaseName('Themis', 'bak'), 'Themis_restore')
assert.equal(suggestedImportDatabaseName('Themis', 'bacpac'), 'Themis_import')

// ─── RESTORE from .bak ───────────────────────────────────────────────────────
assert.equal(buildFileListStatement("C:\\b\\it's.bak"), "RESTORE FILELISTONLY FROM DISK = N'C:\\b\\it''s.bak'")

const restore = buildRestoreStatement({
  database: 'My-DB',
  path: 'C:\\b\\db.bak',
  files: [
    { logicalName: 'MyDB', type: 'D' },
    { logicalName: 'MyDB_log', type: 'L' },
    { logicalName: 'we]ird', type: 'S' }
  ],
  dataDirectory: 'C:\\Data',
  logDirectory: 'C:\\Log',
  replace: false
})
assert.ok(restore.startsWith('RESTORE DATABASE [My-DB]'), restore)
assert.ok(restore.includes("FROM DISK = N'C:\\b\\db.bak'"), restore)
assert.ok(restore.includes("MOVE N'MyDB' TO N'C:\\Data\\MyDB.mdf'"), restore)
assert.ok(restore.includes("MOVE N'MyDB_log' TO N'C:\\Log\\MyDB_log.ldf'"), restore)
// non data/log logical files keep the data directory
assert.ok(restore.includes("MOVE N'we]ird' TO N'C:\\Data\\we]ird.mdf'"), restore)
assert.ok(restore.includes('RECOVERY'), restore)
assert.ok(!restore.includes('REPLACE'), 'REPLACE only when requested')

const replaceRestore = buildRestoreStatement({
  database: 'X', path: 'D:\\x.bak', files: [{ logicalName: 'X', type: 'D' }],
  dataDirectory: '/var/opt/mssql/data', logDirectory: '/var/opt/mssql/log', replace: true
})
assert.ok(replaceRestore.includes("MOVE N'X' TO N'/var/opt/mssql/data/X.mdf'"), replaceRestore)
assert.ok(replaceRestore.includes('REPLACE'), replaceRestore)

console.log('ok — sql backup')
