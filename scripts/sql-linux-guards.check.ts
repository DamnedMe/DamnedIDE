// Self-check for the platform guards of the SQL manager: Windows-only
// transports (LocalDB, Windows Authentication) must fail fast with a clear
// message on Linux/macOS instead of a cryptic socket error.
// Run: node --experimental-strip-types scripts/sql-linux-guards.check.ts
import assert from 'node:assert/strict'
import { validatePlatformSqlConfig } from '../src/shared/sqlConnection.ts'

// Windows: both transports are allowed
validatePlatformSqlConfig({ server: '(localdb)\\MSSQLLocalDB', authType: 'sql' }, 'win32')
validatePlatformSqlConfig({ server: 'sql.example.test', authType: 'windows' }, 'win32')

// Linux/macOS: LocalDB is rejected with a clear message
for (const platform of ['linux', 'darwin']) {
  assert.throws(
    () => validatePlatformSqlConfig({ server: '(localdb)\\MSSQLLocalDB', authType: 'sql' }, platform),
    /LocalDB.*Windows/i,
    `LocalDB must be rejected on ${platform}`
  )
}

// Linux: Windows Authentication without explicit credentials is rejected
assert.throws(
  () => validatePlatformSqlConfig({ server: 'sql.example.test', authType: 'windows' }, 'linux'),
  /NTLM|Windows Authentication/i,
  'Windows auth without credentials must be rejected on linux'
)
// with explicit credentials the guard does not trigger (network decides)
validatePlatformSqlConfig({ server: 'sql.example.test', authType: 'windows', user: 'u', password: 'p' }, 'linux')

// Everything else stays allowed on Linux
validatePlatformSqlConfig({ server: 'sql.example.test', authType: 'sql' }, 'linux')
validatePlatformSqlConfig({ server: 'sql.example.test', authType: 'azure-default' }, 'linux')
validatePlatformSqlConfig({ server: 'sql.example.test' }, 'linux')

console.log('ok — sql platform guards')
