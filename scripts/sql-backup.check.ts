// Self-check for the backup / data-tier helpers.
// Run: node --experimental-strip-types scripts/sql-backup.check.ts
import assert from 'node:assert/strict'
import {
  buildBackupStatement, dataTierArgs, dataTierTargetName, defaultBackupFileName, joinServerPath
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

console.log('ok — sql backup')
