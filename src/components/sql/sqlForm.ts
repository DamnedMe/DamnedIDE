import { SqlAuthType, SqlConnection, SqlConnectionConfig, SqlProtocol } from '../../types/sql'

export const AUTH_TYPES: { value: SqlAuthType; label: string }[] = [
  { value: 'windows', label: 'Windows Authentication' },
  { value: 'sql', label: 'SQL Server Authentication' },
  { value: 'azure-password', label: 'Azure Active Directory - Password' },
  { value: 'azure-default', label: 'Azure Active Directory - Default (Integrated)' },
  { value: 'azure-service-principal', label: 'Azure Active Directory - Service Principal' },
  { value: 'azure-msi-app', label: 'Azure Active Directory - Managed Identity (App Service)' },
  { value: 'azure-msi-vm', label: 'Azure Active Directory - Managed Identity (VM)' },
  { value: 'azure-token', label: 'Azure Active Directory - Access Token' }
]

export interface ConnectionForm {
  server: string
  port: string
  database: string
  authType: SqlAuthType
  domain: string
  user: string
  password: string
  tenantId: string
  clientId: string
  clientSecret: string
  accessToken: string
  encrypt: boolean
  trustServerCertificate: boolean
  connectTimeout: string
  requestTimeout: string
  protocol: SqlProtocol
  rememberPassword: boolean
}

export const EMPTY_FORM: ConnectionForm = {
  server: '',
  port: '',
  database: '',
  authType: 'sql',
  domain: '',
  user: '',
  password: '',
  tenantId: '',
  clientId: '',
  clientSecret: '',
  accessToken: '',
  encrypt: true,
  trustServerCertificate: true,
  connectTimeout: '15',
  requestTimeout: '30',
  protocol: 'default',
  rememberPassword: true
}

export function formToConfig(f: ConnectionForm): SqlConnectionConfig {
  const cfg: SqlConnectionConfig = {
    server: f.server.trim(),
    authType: f.authType,
    protocol: f.protocol,
    encrypt: f.encrypt,
    trustServerCertificate: f.trustServerCertificate,
    rememberPassword: f.rememberPassword
  }
  if (f.database.trim()) cfg.database = f.database.trim()
  if (f.port.trim() && /^\d+$/.test(f.port.trim())) cfg.port = parseInt(f.port.trim(), 10)
  if (f.connectTimeout.trim() && /^\d+$/.test(f.connectTimeout.trim())) cfg.connectTimeout = parseInt(f.connectTimeout.trim(), 10)
  if (f.requestTimeout.trim() && /^\d+$/.test(f.requestTimeout.trim())) cfg.requestTimeout = parseInt(f.requestTimeout.trim(), 10)
  switch (f.authType) {
    case 'windows':
      if (f.domain.trim()) cfg.domain = f.domain.trim()
      if (f.user.trim()) cfg.user = f.user.trim()
      if (f.password) cfg.password = f.password
      break
    case 'sql':
    case 'azure-password':
      if (f.user.trim()) cfg.user = f.user.trim()
      if (f.password) cfg.password = f.password
      break
    case 'azure-service-principal':
      if (f.tenantId.trim()) cfg.tenantId = f.tenantId.trim()
      if (f.clientId.trim()) cfg.clientId = f.clientId.trim()
      if (f.clientSecret) cfg.clientSecret = f.clientSecret
      break
    case 'azure-token':
      if (f.accessToken.trim()) cfg.accessToken = f.accessToken.trim()
      break
    default:
      break
  }
  return cfg
}

export function connectionToForm(c: Partial<SqlConnection>): ConnectionForm {
  return {
    server: c.server || '',
    port: c.port ? String(c.port) : '',
    database: c.database || '',
    authType: c.authType || 'sql',
    domain: c.domain || '',
    user: c.user || '',
    password: c.password || '',
    tenantId: c.tenantId || '',
    clientId: c.clientId || '',
    clientSecret: c.clientSecret || '',
    accessToken: c.accessToken || '',
    encrypt: c.encrypt ?? true,
    trustServerCertificate: c.trustServerCertificate ?? true,
    connectTimeout: c.connectTimeout ? String(c.connectTimeout) : '15',
    requestTimeout: c.requestTimeout ? String(c.requestTimeout) : '30',
    protocol: c.protocol || 'default',
    rememberPassword: true
  }
}

export function connectionLabel(server: string, database?: string): string {
  return `${server}${database ? `/${database}` : ''}`
}

export function authShortLabel(t?: SqlAuthType): string {
  switch (t) {
    case 'windows': return 'windows'
    case 'sql': return 'sql'
    case 'azure-password': return 'aad/password'
    case 'azure-default': return 'aad/default'
    case 'azure-service-principal': return 'aad/sp'
    case 'azure-msi-app': return 'aad/msi-app'
    case 'azure-msi-vm': return 'aad/msi-vm'
    case 'azure-token': return 'aad/token'
    default: return 'sql'
  }
}

// ─── Row editing helpers (Edit Rows / delete row) ───────────────────────────

/** SQL literal for a cell value given its sniffed column type. */
export function sqlLiteral(col: string, v: unknown, colTypes: Record<string, string>): string {
  if (v === null || v === undefined) return 'NULL'
  if (colTypes[col] === 'date') {
    const d = v instanceof Date ? v : new Date(String(v))
    if (!isNaN(d.getTime())) {
      const p = (n: number) => String(n).padStart(2, '0')
      return `'${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}'`
    }
  }
  if (colTypes[col] === 'number' || colTypes[col] === 'bigint' || colTypes[col] === 'boolean') return String(v)
  return `N'${String(v).replace(/'/g, "''")}'`
}

/** Parses the edited text into a raw value matching the column type. */
export function parseEditedValue(text: string, colTypes: Record<string, string>, col: string): unknown {
  if (text.trim() === '') return null
  const t = colTypes[col]
  if (t === 'number' || t === 'bigint') {
    const n = Number(text)
    return isNaN(n) ? text : n
  }
  if (t === 'boolean') return text.toLowerCase() === 'true'
  return text
}

function quoteTable(table: string): string {
  return table.split('.').map(p => `[${p.replace(/^\[|\]$/g, '').replace(/]/g, ']]')}]`).join('.')
}

function quoteColumn(column: string): string {
  return `[${column.replace(/]/g, ']]')}]`
}

/**
 * UPDATE <table> SET [col] = <literal> WHERE [pk1] = <v1> AND [pk2] = <v2>
 * built from the row's PK values. Returns null when the table or PKs are missing.
 */
export function buildUpdateStatement(
  table: string,
  columns: string[],
  row: Record<string, unknown>,
  col: string,
  newValue: unknown,
  colTypes: Record<string, string>,
  primaryKeys: string[]
): string | null {
  if (!table || primaryKeys.length === 0 || !columns.includes(col)) return null
  const pkPreds = primaryKeys
    .filter(pk => columns.includes(pk))
    .map(pk => `${quoteColumn(pk)} = ${sqlLiteral(pk, row[pk], colTypes)}`)
  if (pkPreds.length === 0) return null
  return `UPDATE ${quoteTable(table)}\nSET ${quoteColumn(col)} = ${sqlLiteral(col, newValue, colTypes)}\nWHERE ${pkPreds.join(' AND ')}`
}

/** DELETE FROM <table> WHERE [pk1] = <v1> AND ... — null when not applicable. */
export function buildDeleteStatement(
  table: string,
  columns: string[],
  row: Record<string, unknown>,
  colTypes: Record<string, string>,
  primaryKeys: string[]
): string | null {
  if (!table || primaryKeys.length === 0) return null
  const pkPreds = primaryKeys
    .filter(pk => columns.includes(pk))
    .map(pk => `${quoteColumn(pk)} = ${sqlLiteral(pk, row[pk], colTypes)}`)
  if (pkPreds.length === 0) return null
  return `DELETE FROM ${quoteTable(table)}\nWHERE ${pkPreds.join(' AND ')}`
}
