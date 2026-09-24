import type { SqlAuthType, SqlConnection, SqlConnectionConfig, SqlProtocol } from '../../types/sql'

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

// Windows Authentication (NTLM with the OS session) only exists on Windows:
// elsewhere it needs explicit domain/user/password, so it is hidden unless it is
// the value already stored in the connection being edited.
export function authTypesForPlatform(isWindows: boolean, current?: SqlAuthType): { value: SqlAuthType; label: string }[] {
  if (isWindows) return AUTH_TYPES
  return AUTH_TYPES
    .filter(a => a.value !== 'windows' || a.value === current)
    .map(a => a.value === 'windows' ? { ...a, label: `${a.label} (solo Windows)` } : a)
}

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

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isGuidValue(v: unknown): boolean {
  return typeof v === 'string' && GUID_RE.test(v)
}

/** New v4 UUID, like SQL Server's NEWID(). */
export function newGuid(): string {
  try {
    const c = globalThis.crypto as Crypto | undefined
    if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  } catch { /* fall back below */ }
  const hex = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) { out += '-'; continue }
    if (i === 14) { out += '4'; continue }
    const r = Math.floor(Math.random() * 16)
    out += hex[i === 19 ? (r & 0x3) | 0x8 : r]
  }
  return out
}

/**
 * Parses both the ISO form (`2026-09-25T10:30:00.123`) and the grid form
 * (`25/09/2026 10:30:00.123`). Returns null when the text is not a date.
 */
export function parseDateText(text: string): Date | null {
  const t = text.trim()
  if (!t) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,7}))?)?$/.exec(t)
  if (iso) {
    const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '0'] = iso
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number((frac + '000').slice(0, 3)))
  }
  const eu = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,7}))?)?$/.exec(t)
  if (eu) {
    const [, d, mo, y, h = '0', mi = '0', s = '0', frac = '0'] = eu
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number((frac + '000').slice(0, 3)))
  }
  const fallback = new Date(t)
  return isNaN(fallback.getTime()) ? null : fallback
}

/** The grid's date format (single source of truth for display and pickers). */
export function formatGridDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0') + '00'
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${ms}`
}

/** SQL Server literal for a date value. */
export function formatSqlDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** SQL literal for a cell value given its sniffed column type. */
export function sqlLiteral(col: string, v: unknown, colTypes: Record<string, string>): string {
  if (v === null || v === undefined) return 'NULL'
  if (colTypes[col] === 'date') {
    const d = v instanceof Date ? v : parseDateText(String(v))
    if (d) return `'${formatSqlDate(d)}'`
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

export { quoteTable, quoteColumn }

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

// ─── Insert row helpers ─────────────────────────────────────────────────────

export interface InsertEntry {
  column: string
  literal: string
}

/**
 * Turns the insert-row draft into literal entries. An empty cell is *omitted*
 * (so identity/default constraints apply), the text `NULL` inserts a real NULL,
 * everything else is quoted by column type.
 */
export function buildInsertEntries(
  columns: string[],
  draft: Record<string, string>,
  colTypes: Record<string, string>
): InsertEntry[] {
  const entries: InsertEntry[] = []
  for (const col of columns) {
    const raw = draft[col]
    if (raw === undefined) continue
    const text = raw.trim()
    if (text === '') continue
    if (/^null$/i.test(text)) { entries.push({ column: col, literal: 'NULL' }); continue }
    const type = colTypes[col]
    if (type === 'date') {
      const d = parseDateText(text)
      entries.push({ column: col, literal: d ? `'${formatSqlDate(d)}'` : `N'${text.replace(/'/g, "''")}'` })
      continue
    }
    if (type === 'boolean') {
      const bit = /^(1|true|sì|si|yes)$/i.test(text) ? '1' : /^(0|false|no)$/i.test(text) ? '0' : text
      entries.push({ column: col, literal: bit })
      continue
    }
    if (type === 'number' || type === 'bigint') {
      entries.push({ column: col, literal: text })
      continue
    }
    entries.push({ column: col, literal: `N'${text.replace(/'/g, "''")}'` })
  }
  return entries
}

/** The final INSERT statement shown for review before running it. */
export function buildInsertStatement(table: string, entries: InsertEntry[]): string | null {
  if (!table || entries.length === 0) return null
  const cols = entries.map(e => quoteColumn(e.column)).join(', ')
  const vals = entries.map(e => e.literal).join(', ')
  return `INSERT INTO ${quoteTable(table)} (${cols})\nVALUES (${vals})`
}
