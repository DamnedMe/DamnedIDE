import { ConnectionPool } from 'mssql'
import type { config as sqlConfig, IResult, Request } from 'mssql'
import { parseSqlConnectionString } from '@tediousjs/connection-string'
import net from 'net'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { connectPoolWithRetry, normalizeSqlConnectionConfig, parseSqlServerTarget, sqlTimeoutMilliseconds, validatePlatformSqlConfig } from '../../../src/shared/sqlConnection'

export type SqlAuthType =
  | 'windows'
  | 'sql'
  | 'azure-password'
  | 'azure-default'
  | 'azure-service-principal'
  | 'azure-msi-app'
  | 'azure-msi-vm'
  | 'azure-token'

export type SqlProtocol = 'default' | 'tcp' | 'named-pipes'

export interface SqlConnectionConfig {
  server: string
  database?: string
  user?: string
  password?: string
  port?: number
  trustServerCertificate?: boolean
  connectionId?: string
  authType?: SqlAuthType
  domain?: string
  tenantId?: string
  clientId?: string
  clientSecret?: string
  accessToken?: string
  encrypt?: boolean
  /** Seconds; mssql receives milliseconds only in buildPoolConfig. */
  connectTimeout?: number
  /** Seconds; mssql receives milliseconds only in buildPoolConfig. */
  requestTimeout?: number
  protocol?: SqlProtocol
}

export interface SqlQueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  colTypes?: Record<string, string>
  primaryKeys?: string[]
  foreignKeys?: string[]
  foreignKeyInfo?: SqlForeignKeyInfo[]
  baseTableColumns?: string[]
}

export interface SqlExecutionResult {
  queryId: string
  results: SqlQueryResult[]
  totalRowCount: number
  truncated: boolean
  maxRows: number
  elapsedMs: number
  canceled: boolean
  rowsAffected: number[]
}

export interface SqlForeignKeyInfo {
  column: string
  table: string
  referencedTable: string
  referencedColumn: string
}

export interface SqlColumnInfo {
  name: string
  type: string
  maxLength: number | null
  nullable: boolean
  isPrimaryKey: boolean
  isForeignKey: boolean
  defaultValue: string | null
}

export interface SqlForeignKeyEdge {
  constraintName: string
  table: string
  column: string
  referencedTable: string
  referencedColumn: string
}

export interface SqlDiagramData {
  tables: { name: string; columns: SqlColumnInfo[] }[]
  edges: SqlForeignKeyEdge[]
}

export interface SqlSchemaSnapshot {
  database: string
  loadedAt: number
  objects: Array<{ name: string; schema: string; kind: 'table' | 'view'; columns: SqlColumnInfo[] }>
  foreignKeys: SqlForeignKeyEdge[]
  routines: Array<{
    name: string
    schema: string
    kind: 'procedure' | 'function'
    parameters: Array<{ name: string; type: string; output: boolean }>
  }>
}

export const AUTH_TYPE_LABELS: Record<SqlAuthType, string> = {
  'windows': 'Windows Authentication',
  'sql': 'SQL Server Authentication',
  'azure-password': 'Azure Active Directory - Password',
  'azure-default': 'Azure Active Directory - Default (Integrated)',
  'azure-service-principal': 'Azure Active Directory - Service Principal',
  'azure-msi-app': 'Azure Active Directory - Managed Identity (App Service)',
  'azure-msi-vm': 'Azure Active Directory - Managed Identity (VM)',
  'azure-token': 'Azure Active Directory - Access Token'
}

// ─── Connection string helpers ──────────────────────────────────────────────

export function buildConnectionString(c: SqlConnectionConfig): string {
  // Values containing separators/quotes are brace-quoted (ADO.NET style).
  const esc = (v: string) => (/[;"'{}]/.test(v) ? `{${v}}` : v)
  const parts: string[] = []
  if (c.server) {
    parts.push(`Server=${esc(c.server)}${c.port ? `,${c.port}` : ''}`)
  }
  if (c.database) parts.push(`Database=${esc(c.database)}`)
  if (c.authType === 'windows') parts.push('Integrated Security=SSPI')
  else if (c.authType === 'sql') {
    if (c.user) parts.push(`User ID=${esc(c.user)}`)
    if (c.password) parts.push(`Password=${esc(c.password)}`)
  } else if (c.authType === 'azure-password') {
    parts.push('Authentication=Active Directory Password')
    if (c.user) parts.push(`User ID=${esc(c.user)}`)
    if (c.password) parts.push(`Password=${esc(c.password)}`)
  } else if (c.authType === 'azure-default') {
    parts.push('Authentication=Active Directory Integrated')
  } else if (c.authType === 'azure-service-principal') {
    if (c.tenantId) parts.push(`Tenant ID=${esc(c.tenantId)}`)
    if (c.clientId) parts.push(`Client ID=${esc(c.clientId)}`)
    if (c.clientSecret) parts.push(`Client Secret=${esc(c.clientSecret)}`)
  } else if (c.authType === 'azure-token') {
    if (c.accessToken) parts.push(`Access Token=${esc(c.accessToken)}`)
  }
  if (c.encrypt !== undefined) parts.push(`Encrypt=${c.encrypt ? 'True' : 'False'}`)
  if (c.trustServerCertificate !== undefined) parts.push(`TrustServerCertificate=${c.trustServerCertificate ? 'True' : 'False'}`)
  if (c.connectTimeout !== undefined) parts.push(`Connect Timeout=${c.connectTimeout}`)
  if (c.requestTimeout !== undefined) parts.push(`Request Timeout=${c.requestTimeout}`)
  if (c.protocol === 'named-pipes') parts.push('Network Library=dbnmpntw')
  else if (c.protocol === 'tcp') parts.push('Network Library=dbmssocn')
  parts.push('Application Name=DamnedIDE')
  return parts.join(';')
}

export function parseConnectionString(cs: string): SqlConnectionConfig {
  const p = parseSqlConnectionString(cs, true) as Record<string, string | number | boolean>
  const cfg: SqlConnectionConfig = { server: '' }
  const dataSource = String(p['data source'] ?? p['server'] ?? '').trim()
  if (dataSource) {
    const m = dataSource.match(/^tcp:?(.*)$/i)
    const ds = (m ? m[1] : dataSource).trim()
    const comma = ds.lastIndexOf(',')
    if (comma > 0 && /^\d+$/.test(ds.slice(comma + 1).trim())) {
      cfg.server = ds.slice(0, comma).trim()
      cfg.port = parseInt(ds.slice(comma + 1).trim(), 10)
    } else {
      cfg.server = ds
    }
  }
  const catalog = String(p['initial catalog'] ?? '').trim()
  if (catalog) cfg.database = catalog
  const uid = String(p['user id'] ?? '').trim()
  const pwd = String(p['password'] ?? '')
  const integrated = p['integrated security'] === true || String(p['integrated security'] ?? '').toLowerCase() === 'sspi'
  const auth = String(p['authentication'] ?? '').trim()
  if (integrated || auth.toLowerCase().startsWith('active directory integrated')) {
    cfg.authType = 'windows'
    if (!integrated && auth.toLowerCase().startsWith('active directory integrated')) cfg.authType = 'azure-default'
  } else if (auth.toLowerCase().startsWith('active directory password')) {
    cfg.authType = 'azure-password'
  } else if (uid || pwd) {
    cfg.authType = 'sql'
  } else {
    cfg.authType = 'sql'
  }
  if (cfg.authType === 'sql' || cfg.authType === 'azure-password') {
    if (uid) cfg.user = uid
    if (pwd) cfg.password = pwd
  }
  if (p['encrypt'] !== undefined) cfg.encrypt = Boolean(p['encrypt'])
  if (p['trustservercertificate'] !== undefined) cfg.trustServerCertificate = Boolean(p['trustservercertificate'])
  const ct = p['connection timeout']
  if (typeof ct === 'number') cfg.connectTimeout = ct
  const rt = p['request timeout']
  if (typeof rt === 'number') cfg.requestTimeout = rt
  const netLib = String(p['network library'] ?? '').trim().toLowerCase()
  if (netLib === 'dbnmpntw') cfg.protocol = 'named-pipes'
  else if (netLib === 'dbmssocn') cfg.protocol = 'tcp'
  const tenant = String(p['tenant id'] ?? '').trim()
  const cid = String(p['client id'] ?? '').trim()
  const secret = String(p['client secret'] ?? '')
  const token = String(p['access token'] ?? '')
  if (tenant || cid || secret) cfg.authType = 'azure-service-principal'
  if (tenant) cfg.tenantId = tenant
  if (cid) cfg.clientId = cid
  if (secret) cfg.clientSecret = secret
  if (token) {
    cfg.authType = 'azure-token'
    cfg.accessToken = token
  }
  return cfg
}

// ─── Existing helpers (LocalDB, type detection, table extraction) ──────────

function sniffType(v: unknown): string {
  if (v === null || v === undefined) return 'other'
  if (v instanceof Date) return 'date'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'bigint') return 'bigint'
  if (Buffer.isBuffer(v)) return 'binary'
  return 'string'
}

const IDENT_RE = /^[A-Za-z0-9_]+$/

// Safe bracketed database identifier for metadata queries: `My-DB` → `[My-DB]`,
// embedded `]` is escaped (`]]`) so hyphens/dots can never break the query.
function dbRef(database: string): string {
  return `[${database.replace(/]/g, ']]')}]`
}

function extractTables(query: string): { schema: string; name: string }[] {
  const cleaned = query
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/'[^']*'/g, ' ')
  const tables: { schema: string; name: string }[] = []
  // Bracketed parts may contain hyphens/spaces (`[themis-masterdb-dev]`); bare
  // identifiers stay alphanumeric. Handles `Table`, `schema.Table`, `[db].[schema].[Table]`.
  const ident = '(?:\\[[^\\]]+\\]|[A-Za-z0-9_]+)'
  const strip = (s: string) => s.replace(/^\[|\]$/g, '')
  const re = new RegExp(`(?:FROM|JOIN)\\s+(${ident})(?:\\s*\\.\\s*(${ident}))?(?:\\s*\\.\\s*(${ident}))?`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned))) {
    const first = strip(m[1])
    const second = m[2] ? strip(m[2]) : undefined
    const third = m[3] ? strip(m[3]) : undefined
    const schema = third ? (second ?? 'dbo') : (second ? first : 'dbo')
    const name = third ?? second ?? first
    const bracketed = /^\[.*\]$/s.test(m[1])
    if (bracketed || (IDENT_RE.test(schema) && IDENT_RE.test(name))) tables.push({ schema, name })
  }
  const seen = new Set<string>()
  return tables.filter(t => {
    const k = `${t.schema}.${t.name}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 4)
}

function findSqlLocalDb(): string | null {
  try {
    execSync('where SqlLocalDB.exe', { stdio: 'ignore', windowsHide: true })
    return 'SqlLocalDB.exe'
  } catch { /* not on PATH */ }
  const baseDirs = [
    'C:\\Program Files\\Microsoft SQL Server',
    'C:\\Program Files (x86)\\Microsoft SQL Server'
  ]
  for (const base of baseDirs) {
    if (!existsSync(base)) continue
    try {
      const versions = execSync(`dir /b /ad "${base}"`, { encoding: 'utf8', windowsHide: true })
        .split('\n').map(v => v.trim()).filter(Boolean)
      for (const ver of versions) {
        for (const sub of ['Tools\\Binn', 'Shared']) {
          const candidate = join(base, ver, sub, 'SqlLocalDB.exe')
          if (existsSync(candidate)) return candidate
        }
      }
    } catch { /* ignore */ }
  }
  const direct = [
    'C:\\Program Files\\Microsoft SQL Server\\130\\Tools\\Binn\\SqlLocalDB.exe',
    'C:\\Program Files\\Microsoft SQL Server\\140\\Tools\\Binn\\SqlLocalDB.exe',
    'C:\\Program Files\\Microsoft SQL Server\\150\\Tools\\Binn\\SqlLocalDB.exe',
    'C:\\Program Files\\Microsoft SQL Server\\160\\Tools\\Binn\\SqlLocalDB.exe'
  ]
  for (const d of direct) if (existsSync(d)) return d
  return null
}

function stripPipePrefix(pipe: string): string {
  let p = pipe.trim()
  if (p.startsWith('np:')) p = p.slice(3)
  return p
}

const localDbPipeCache = new Map<string, { pipe: string; expiresAt: number }>()

function localDbInstanceName(server: string): string {
  return parseSqlServerTarget(server).instanceName || 'MSSQLLocalDB'
}

function invalidateLocalDbPipe(server: string): void {
  localDbPipeCache.delete(localDbInstanceName(server).toLocaleLowerCase())
}

function pipeFromRegistry(instance: string): string | null {
  try {
    const out = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Microsoft SQL Server\\UserInstances" /s',
      { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    )
    const blocks = out.split(/\r?\n(?=HKEY_)/i)
    let firstPipe: string | null = null
    for (const block of blocks) {
      const nameMatch = block.match(/InstanceName\s+REG_SZ\s+([^\r\n]+)/i)
      const pipeMatch = block.match(/InstancePipeName\s+REG_SZ\s+([^\r\n]+)/i)
      if (!pipeMatch) continue
      const pipe = stripPipePrefix(pipeMatch[1])
      const name = nameMatch ? nameMatch[1].trim() : ''
      if (!firstPipe) firstPipe = pipe
      if (name.toLowerCase() === instance.toLowerCase()) return pipe
    }
    return firstPipe
  } catch (e) {
    console.error('[sql] reg query fallita:', (e as Error).message)
    return null
  }
}

function resolveLocalDbPipe(server: string): string | null {
  const s = server.trim()
  if (!/^\(localdb\)/i.test(s)) return null

  // Normalize the instance: `(localdb)\X`, `(localdb)\\X` and trailing slashes
  // must all yield `X` (empty → MSSQLLocalDB).
  const instance = localDbInstanceName(s)
  const cacheKey = instance.toLocaleLowerCase()
  const cached = localDbPipeCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.pipe

  const sqllocaldb = findSqlLocalDb()
  if (!sqllocaldb) {
    const regPipe = pipeFromRegistry(instance)
    if (regPipe) {
      localDbPipeCache.set(cacheKey, { pipe: regPipe, expiresAt: Date.now() + 5_000 })
      return regPipe
    }
    console.error('[sql] SqlLocalDB.exe non trovato')
    return null
  }
  try {
    execSync(`"${sqllocaldb}" start "${instance}"`, { stdio: 'ignore', windowsHide: true })
    const out = execSync(`"${sqllocaldb}" info "${instance}"`, { encoding: 'utf8', windowsHide: true })
    const line = out.split(/\r?\n/).find(l => /LOCALDB#/i.test(l))
    if (!line) {
      console.error('[sql] pipe name non trovato in output:', out)
      return null
    }
    let pipeName = line.trim()
    const idx = pipeName.indexOf(':')
    if (idx >= 0) pipeName = pipeName.slice(idx + 1).trim()
    pipeName = stripPipePrefix(pipeName)
    localDbPipeCache.set(cacheKey, { pipe: pipeName, expiresAt: Date.now() + 30_000 })
    console.log('[sql] LocalDB pipe risolto:', pipeName)
    return pipeName
  } catch (e) {
    console.error('[sql] risoluzione LocalDB fallita:', (e as Error).message)
    return pipeFromRegistry(instance)
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

function authOptions(config: SqlConnectionConfig): { type: string; options?: Record<string, string> } {
  switch (config.authType ?? 'sql') {
    case 'windows':
      return {
        type: 'ntlm',
        options: {
          ...(config.domain ? { domain: config.domain } : {}),
          ...(config.user ? { userName: config.user } : {}),
          ...(config.password ? { password: config.password } : {})
        }
      }
    case 'azure-password':
      return { type: 'azure-active-directory-password', options: { userName: config.user || '', password: config.password || '' } }
    case 'azure-default':
      return { type: 'azure-active-directory-default', options: {} }
    case 'azure-service-principal':
      return {
        type: 'azure-active-directory-service-principal-secret',
        options: { tenantId: config.tenantId || '', clientId: config.clientId || '', clientSecret: config.clientSecret || '' }
      }
    case 'azure-msi-app':
      return { type: 'azure-active-directory-msi-app-service', options: {} }
    case 'azure-msi-vm':
      return { type: 'azure-active-directory-msi-vm', options: {} }
    case 'azure-token':
      return { type: 'azure-active-directory-access-token', options: { token: config.accessToken || '' } }
    default:
      return { type: 'default' }
  }
}

export class SqlService {
  private connections: Map<string, { pool: ConnectionPool; config: SqlConnectionConfig }> = new Map()
  private counter: number = 0
  private activeRequests: Map<string, Request> = new Map()

  private getPool(connectionId: string): ConnectionPool {
    const entry = this.connections.get(connectionId)
    if (!entry) throw new Error('Connessione non trovata')
    return entry.pool
  }

  private buildPoolConfig(config: SqlConnectionConfig): sqlConfig {
    const normalized = normalizeSqlConnectionConfig(config)
    const target = parseSqlServerTarget(normalized.server)
    const pipe = resolveLocalDbPipe(normalized.server)
    const base: sqlConfig = {
      server: pipe ? 'localhost' : target.host,
      database: normalized.database,
      user: normalized.user,
      password: normalized.password,
      port: normalized.port || target.port || 1433,
      connectionTimeout: sqlTimeoutMilliseconds(normalized.connectTimeout, 15_000),
      requestTimeout: sqlTimeoutMilliseconds(normalized.requestTimeout, 30_000),
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
      options: {
        trustServerCertificate: normalized.trustServerCertificate ?? true,
        encrypt: pipe ? false : normalized.encrypt ?? true,
        ...(!pipe && target.instanceName ? { instanceName: target.instanceName } : {})
      }
    }
    if (pipe) {
      base.options = {
        ...base.options,
        connector: ((_opts: unknown, _lookup: unknown, signal: AbortSignal) =>
          new Promise<net.Socket>((resolve, reject) => {
            const socket = net.connect({ path: pipe })
            if (signal?.aborted) { socket.destroy(); reject(new Error('Connection aborted')); return }
            const onAbort = () => { socket.destroy(); reject(new Error('Connection aborted')) }
            signal?.addEventListener('abort', onAbort)
            socket.once('connect', () => {
              signal?.removeEventListener('abort', onAbort)
              resolve(socket)
            })
            socket.once('error', (err) => {
              signal?.removeEventListener('abort', onAbort)
              reject(err)
            })
          })) as unknown as () => Promise<net.Socket>
      }
    }
    // LocalDB (named pipe): keep the plain login that historically worked.
    // Remote TCP: honor the chosen authentication type.
    base.authentication = (pipe
      ? { type: 'default', options: {} }
      : authOptions(normalized)) as sqlConfig['authentication']
    return base
  }

  private openPool(config: SqlConnectionConfig): Promise<ConnectionPool> {
    const normalized = normalizeSqlConnectionConfig(config)
    validatePlatformSqlConfig(normalized)
    return connectPoolWithRetry((attempt) => {
      if (attempt > 1 && parseSqlServerTarget(normalized.server).isLocalDb) invalidateLocalDbPipe(normalized.server)
      return new ConnectionPool(this.buildPoolConfig(normalized))
    })
  }

  async connect(config: SqlConnectionConfig): Promise<string> {
    const normalized = normalizeSqlConnectionConfig(config)
    const id = normalized.connectionId || `conn_${++this.counter}`
    const existing = this.connections.get(id)
    if (existing) {
      try { await existing.pool.close() } catch { /* ignore */ }
      this.connections.delete(id)
    }
    const pool = await this.openPool(normalized)
    this.connections.set(id, { pool, config: normalized })
    return id
  }

  async disconnect(connectionId: string): Promise<void> {
    const entry = this.connections.get(connectionId)
    if (entry) {
      await entry.pool.close()
      this.connections.delete(connectionId)
    }
  }

  /**
   * Opens a short-lived connection pinned to `database` (sys.* catalogs are
   * database-scoped, so metadata must run in the target database's context).
   * The main pool is never touched, so its session contexts stay unchanged.
   */
  private async openScopedPool(connectionId: string, database: string): Promise<ConnectionPool> {
    const entry = this.connections.get(connectionId)
    if (!entry) throw new Error('Connessione non trovata')
    return this.openPool({ ...entry.config, database })
  }

  async testConnection(config: SqlConnectionConfig): Promise<{ ok: boolean; error?: string; version?: string }> {
    let pool: ConnectionPool | null = null
    try {
      pool = await this.openPool(config)
      const r = await pool.request().query('SELECT @@VERSION AS version')
      const version = r.recordset[0]?.version as string | undefined
      return { ok: true, version }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    } finally {
      try { await pool?.close() } catch { /* ignore */ }
    }
  }

  async getServerInfo(connectionId: string): Promise<{ version: string; server: string; database: string }> {
    const pool = this.getPool(connectionId)
    const r = await pool.request().query(
      'SELECT @@VERSION AS version, @@SERVERNAME AS [server], DB_NAME() AS [database]'
    )
    const row = r.recordset[0] || {}
    return {
      version: String(row.version ?? ''),
      server: String(row.server ?? ''),
      database: String(row.database ?? '')
    }
  }

  cancelQuery(queryId: string): void {
    const req = this.activeRequests.get(queryId)
    if (req) {
      req.cancel()
      this.activeRequests.delete(queryId)
    }
  }

  async executeQuery(
    connectionId: string,
    query: string,
    queryId?: string,
    maxRows: number = 250000,
    database?: string
  ): Promise<SqlExecutionResult> {
    const pool = this.getPool(connectionId)
    if (!pool) throw new Error('Connessione non trovata')

    const qid = queryId || `q_${++this.counter}`
    const started = Date.now()
    const request = pool.request()
    request.multiple = true
    this.activeRequests.set(qid, request)
    try {
      const result = await request.query(query)
      type RawRecordset = Record<string, unknown>[] & { columns?: Record<string, unknown> }
      const rsets = (result as { recordsets?: (RawRecordset | null)[] }).recordsets
      const recordsets: RawRecordset[] = (rsets && rsets.length > 0
        ? rsets
        : [result.recordset as RawRecordset])
        .filter(rs => rs !== null && rs !== undefined) as RawRecordset[]
      let truncated = false
      const results: SqlQueryResult[] = []
      for (let i = 0; i < recordsets.length; i++) {
        let rows = recordsets[i] as Record<string, unknown>[]
        if (rows.length > maxRows) {
          rows = rows.slice(0, maxRows)
          truncated = true
        }
        const declaredColumns = Object.keys(recordsets[i].columns || {})
        results.push(await this.toQueryResult(connectionId, pool, query, rows, i === 0, database, declaredColumns))
      }
      return {
        queryId: qid,
        results,
        totalRowCount: results.reduce((n, r) => n + r.rowCount, 0),
        truncated,
        maxRows,
        elapsedMs: Date.now() - started,
        canceled: false,
        rowsAffected: result.rowsAffected || []
      }
    } catch (e) {
      if (!(e as { canceled?: boolean })?.canceled) throw e
      return {
        queryId: qid,
        results: [],
        totalRowCount: 0,
        truncated: false,
        maxRows,
        elapsedMs: Date.now() - started,
        canceled: true,
        rowsAffected: []
      }
    } finally {
      this.activeRequests.delete(qid)
    }
  }

  private async toQueryResult(
    connectionId: string,
    pool: ConnectionPool,
    query: string,
    rows: Record<string, unknown>[],
    isFirst: boolean,
    database?: string,
    declaredColumns: string[] = []
  ): Promise<SqlQueryResult> {
    const columns: string[] = rows.length > 0 ? Object.keys(rows[0] ?? {}) : declaredColumns
    const colTypes: Record<string, string> = {}
    if (rows.length > 0) {
      const sample = rows[0]
      for (const c of columns) colTypes[c] = sniffType(sample[c])
    }

    const result: SqlQueryResult = {
      columns,
      rows,
      rowCount: rows.length,
      colTypes,
      primaryKeys: [],
      foreignKeys: [],
      foreignKeyInfo: [],
      baseTableColumns: []
    }

    if (!isFirst || rows.length === 0) return result

    const tables = extractTables(query)
    if (tables.length === 0) return result

    // sys.* catalogs are database-scoped, so metadata must run in the target
    // database's context. A short-lived dedicated pool is used when the caller
    // knows the database — the main pool's session contexts stay untouched.
    let meta: ConnectionPool = pool
    let scoped: ConnectionPool | null = null
    if (database) {
      try {
        scoped = await this.openScopedPool(connectionId, database)
        meta = scoped
      } catch { /* metadata connection failure ignored */ }
    }
    const base = tables[0]
    const tasks: Promise<void>[] = []
    tasks.push((async () => {
      try {
        const colRes = await meta.request().query(
          `SELECT c.name
           FROM sys.columns c
           WHERE c.object_id = OBJECT_ID('${base.schema}.${base.name}')
           ORDER BY c.column_id`
        )
        result.baseTableColumns = colRes.recordset.map(r => String(r.name))
      } catch { /* metadata failure ignored */ }
    })())
    tasks.push((async () => {
      try {
        const pkRes = await meta.request().query(
          `SELECT OBJECT_SCHEMA_NAME(kc.parent_object_id) AS TABLE_SCHEMA,
                  OBJECT_NAME(kc.parent_object_id) AS TABLE_NAME,
                  c.name AS COLUMN_NAME
           FROM sys.key_constraints kc
           JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
           JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
           WHERE kc.type = 'PK'`
        )
        const pkNames = new Set(tables.map(t => t.name.toLowerCase()))
        for (const r of pkRes.recordset) {
          if (!pkNames.has(String(r.TABLE_NAME).toLowerCase())) continue
          result.primaryKeys!.push(String(r.COLUMN_NAME))
        }
        const fkRes = await meta.request().query(
          `SELECT OBJECT_SCHEMA_NAME(fk.parent_object_id) AS TABLE_SCHEMA,
                  OBJECT_NAME(fk.parent_object_id) AS TABLE_NAME,
                  c1.name AS COLUMN_NAME
           FROM sys.foreign_keys fk
           JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
           JOIN sys.columns c1 ON c1.object_id = fkc.parent_object_id AND c1.column_id = fkc.parent_column_id`
        )
        const fkNames = new Set(tables.map(t => t.name.toLowerCase()))
        for (const r of fkRes.recordset) {
          if (!fkNames.has(String(r.TABLE_NAME).toLowerCase())) continue
          result.foreignKeys!.push(String(r.COLUMN_NAME))
        }
      } catch { /* metadata failure ignored */ }
    })())
    tasks.push((async () => {
      try {
        const fkRes = await meta.request().query(
          `SELECT OBJECT_SCHEMA_NAME(fk.parent_object_id) AS TABLE_SCHEMA,
                  OBJECT_NAME(fk.parent_object_id) AS TABLE_NAME,
                  c1.name AS COLUMN_NAME,
                  OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS REF_TABLE_SCHEMA,
                  OBJECT_NAME(fk.referenced_object_id) AS REF_TABLE_NAME,
                  c2.name AS REF_COLUMN_NAME
           FROM sys.foreign_keys fk
           JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
           JOIN sys.columns c1 ON c1.object_id = fkc.parent_object_id AND c1.column_id = fkc.parent_column_id
           JOIN sys.columns c2 ON c2.object_id = fkc.referenced_object_id AND c2.column_id = fkc.referenced_column_id`
        )
        const names = new Set(tables.map(t => t.name.toLowerCase()))
        for (const r of fkRes.recordset) {
          if (!names.has(String(r.TABLE_NAME).toLowerCase())) continue
          const col = String(r.COLUMN_NAME)
          const refCol = String(r.REF_COLUMN_NAME)
          const table = `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`
          const refTable = `${r.REF_TABLE_SCHEMA}.${r.REF_TABLE_NAME}`
          const parts = [col, refCol, ...table.split('.'), ...refTable.split('.')]
          if (!parts.every(p => IDENT_RE.test(p))) continue
          result.foreignKeyInfo!.push({ column: col, table, referencedTable: refTable, referencedColumn: refCol })
        }
      } catch { /* metadata failure ignored */ }
    })())
    await Promise.allSettled(tasks)
    if (scoped) {
      try { await scoped.close() } catch { /* ignore */ }
    }
    return result
  }

  async listDatabases(connectionId: string): Promise<string[]> {
    const pool = this.getPool(connectionId)
    const result = await pool.request().query(
      `SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name`
    )
    return result.recordset.map(r => r.name as string)
  }

  async listTables(connectionId: string, database: string): Promise<string[]> {
    const pool = this.getPool(connectionId)
    const result = await pool.request().query(
      `SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS fullName
       FROM ${dbRef(database)}.INFORMATION_SCHEMA.TABLES
       WHERE TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_SCHEMA, TABLE_NAME`
    )
    return result.recordset.map(r => r.fullName as string)
  }

  async listViews(connectionId: string, database: string): Promise<string[]> {
    const pool = this.getPool(connectionId)
    const result = await pool.request().query(
      `SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS fullName
       FROM ${dbRef(database)}.INFORMATION_SCHEMA.VIEWS
       ORDER BY TABLE_SCHEMA, TABLE_NAME`
    )
    return result.recordset.map(r => r.fullName as string)
  }

  async listStoredProcedures(connectionId: string, database: string): Promise<string[]> {
    const pool = this.getPool(connectionId)
    const result = await pool.request().query(
      `SELECT SPECIFIC_SCHEMA + '.' + SPECIFIC_NAME AS fullName
       FROM ${dbRef(database)}.INFORMATION_SCHEMA.ROUTINES
       WHERE ROUTINE_TYPE = 'PROCEDURE'
       ORDER BY SPECIFIC_SCHEMA, SPECIFIC_NAME`
    )
    return result.recordset.map(r => r.fullName as string)
  }

  async listFunctions(connectionId: string, database: string): Promise<string[]> {
    const pool = this.getPool(connectionId)
    const result = await pool.request().query(
      `SELECT SPECIFIC_SCHEMA + '.' + SPECIFIC_NAME AS fullName
       FROM ${dbRef(database)}.INFORMATION_SCHEMA.ROUTINES
       WHERE ROUTINE_TYPE = 'FUNCTION'
       ORDER BY SPECIFIC_SCHEMA, SPECIFIC_NAME`
    )
    return result.recordset.map(r => r.fullName as string)
  }

  /** Definition (CREATE script) of a view, stored procedure or function. */
  async objectDefinition(connectionId: string, database: string, objectName: string): Promise<string> {
    const pool = this.getPool(connectionId)
    const [schema, name] = objectName.split('.')
    const esc = (s: string) => s.replace(/'/g, "''")
    // OBJECT_DEFINITION only resolves objects in the current database, so pin
    // the session context with a leading `USE` in the same batch.
    const result = await pool.request().query(
      `USE ${dbRef(database)};
       SELECT OBJECT_DEFINITION(OBJECT_ID('${esc(schema)}.${esc(name)}')) AS definition`
    )
    const def = result.recordset[0]?.definition
    if (!def) throw new Error(`definizione non trovata per ${objectName}`)
    return String(def)
  }

  async listColumns(connectionId: string, database: string, table: string): Promise<SqlColumnInfo[]> {
    const pool = this.getPool(connectionId)
    const [schema, name] = table.split('.')
    const db = dbRef(database)
    const esc = (s: string) => s.replace(/'/g, "''")
    const q =
      `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.IS_NULLABLE,
              c.COLUMN_DEFAULT,
              CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK,
              CASE WHEN fk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_FK
       FROM ${db}.INFORMATION_SCHEMA.COLUMNS c
       LEFT JOIN (
         SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
         FROM ${db}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         JOIN ${db}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
           ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
         WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
       ) pk ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA AND pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
       LEFT JOIN (
         SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
         FROM ${db}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         JOIN ${db}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
           ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
         WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
       ) fk ON fk.TABLE_SCHEMA = c.TABLE_SCHEMA AND fk.TABLE_NAME = c.TABLE_NAME AND fk.COLUMN_NAME = c.COLUMN_NAME
       WHERE c.TABLE_SCHEMA = '${esc(schema)}' AND c.TABLE_NAME = '${esc(name)}'
       ORDER BY c.ORDINAL_POSITION`
    const result = await pool.request().query(q)
    return result.recordset.map(r => ({
      name: String(r.COLUMN_NAME),
      type: String(r.DATA_TYPE) + (r.CHARACTER_MAXIMUM_LENGTH ? `(${r.CHARACTER_MAXIMUM_LENGTH})` : ''),
      maxLength: r.CHARACTER_MAXIMUM_LENGTH != null ? Number(r.CHARACTER_MAXIMUM_LENGTH) : null,
      nullable: String(r.IS_NULLABLE).toUpperCase() === 'YES',
      isPrimaryKey: Number(r.IS_PK) === 1,
      isForeignKey: Number(r.IS_FK) === 1,
      defaultValue: r.COLUMN_DEFAULT != null ? String(r.COLUMN_DEFAULT) : null
    }))
  }

  async getDiagram(connectionId: string, database: string, tableFilter?: string[]): Promise<SqlDiagramData> {
    const pool = this.getPool(connectionId)
    const filterSet = new Set((tableFilter || []).map(t => t.toLowerCase()))
    const db = dbRef(database)

    // Fetch every table/column/constraint in two set-based catalog queries.
    // The old implementation issued one listColumns query per table; that N+1
    // pattern made diagrams with hundreds of tables look frozen.
    const [columnsRes, edgesRes] = await Promise.all([
      pool.request().query(
        `SELECT s.name AS TABLE_SCHEMA, t.name AS TABLE_NAME,
                c.column_id, c.name AS COLUMN_NAME, ty.name AS DATA_TYPE,
                CASE WHEN ty.name IN ('nvarchar', 'nchar') AND c.max_length > 0 THEN c.max_length / 2 ELSE c.max_length END AS MAX_LENGTH,
                c.is_nullable AS IS_NULLABLE, dc.definition AS COLUMN_DEFAULT,
                CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS IS_PK,
                CASE WHEN fk.parent_column_id IS NOT NULL THEN 1 ELSE 0 END AS IS_FK
         FROM ${db}.sys.tables t
         JOIN ${db}.sys.schemas s ON s.schema_id = t.schema_id
         JOIN ${db}.sys.columns c ON c.object_id = t.object_id
         JOIN ${db}.sys.types ty ON ty.user_type_id = c.user_type_id
         LEFT JOIN (
           SELECT ic.object_id, ic.column_id
           FROM ${db}.sys.indexes i
           JOIN ${db}.sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
           WHERE i.is_primary_key = 1
         ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
         LEFT JOIN ${db}.sys.foreign_key_columns fk ON fk.parent_object_id = c.object_id AND fk.parent_column_id = c.column_id
         LEFT JOIN ${db}.sys.default_constraints dc ON dc.object_id = c.default_object_id
         WHERE t.is_ms_shipped = 0
         ORDER BY s.name, t.name, c.column_id`
      ),
      pool.request().query(
        `SELECT fk.name AS CONSTRAINT_NAME,
                ps.name AS TABLE_SCHEMA, pt.name AS TABLE_NAME, pc.name AS COLUMN_NAME,
                rs.name AS REF_TABLE_SCHEMA, rt.name AS REF_TABLE_NAME, rc.name AS REF_COLUMN_NAME
         FROM ${db}.sys.foreign_keys fk
         JOIN ${db}.sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN ${db}.sys.tables pt ON pt.object_id = fkc.parent_object_id
         JOIN ${db}.sys.schemas ps ON ps.schema_id = pt.schema_id
         JOIN ${db}.sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
         JOIN ${db}.sys.tables rt ON rt.object_id = fkc.referenced_object_id
         JOIN ${db}.sys.schemas rs ON rs.schema_id = rt.schema_id
         JOIN ${db}.sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
         ORDER BY fk.name, fkc.constraint_column_id`
      )
    ])

    const allTables = [...new Set(columnsRes.recordset.map(r => `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`))]
    // A table-scoped diagram is useful only if it also contains its direct
    // neighbours. Expand the explicit selection by one FK hop.
    if (tableFilter && tableFilter.length > 0) {
      const seeds = new Set(filterSet)
      for (const r of edgesRes.recordset) {
        const table = `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`
        const refTable = `${r.REF_TABLE_SCHEMA}.${r.REF_TABLE_NAME}`
        if (seeds.has(table.toLowerCase())) filterSet.add(refTable.toLowerCase())
        if (seeds.has(refTable.toLowerCase())) filterSet.add(table.toLowerCase())
      }
    }
    const selected = tableFilter && tableFilter.length > 0
      ? allTables.filter(t => filterSet.has(t.toLowerCase()))
      : allTables
    const sel = new Set(selected.map(t => t.toLowerCase()))
    const tableMap = new Map<string, SqlColumnInfo[]>(selected.map(t => [t, []]))
    for (const r of columnsRes.recordset) {
      const name = `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`
      const columns = tableMap.get(name)
      if (!columns) continue
      const maxLength = r.MAX_LENGTH == null || Number(r.MAX_LENGTH) < 0 ? null : Number(r.MAX_LENGTH)
      const dataType = String(r.DATA_TYPE)
      const type = maxLength && ['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary'].includes(dataType.toLowerCase())
        ? `${dataType}(${maxLength})`
        : dataType
      columns.push({
        name: String(r.COLUMN_NAME),
        type,
        maxLength,
        nullable: Boolean(r.IS_NULLABLE),
        isPrimaryKey: Number(r.IS_PK) === 1,
        isForeignKey: Number(r.IS_FK) === 1,
        defaultValue: r.COLUMN_DEFAULT != null ? String(r.COLUMN_DEFAULT) : null
      })
    }
    const tables = selected.map(name => ({ name, columns: tableMap.get(name) || [] }))

    const edges: SqlForeignKeyEdge[] = []
    for (const r of edgesRes.recordset) {
      const table = `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`
      const refTable = `${r.REF_TABLE_SCHEMA}.${r.REF_TABLE_NAME}`
      if (!sel.has(table.toLowerCase()) || !sel.has(refTable.toLowerCase())) continue
      const col = String(r.COLUMN_NAME)
      const refCol = String(r.REF_COLUMN_NAME)
      const parts = [col, refCol, ...table.split('.'), ...refTable.split('.')]
      if (!parts.every(p => IDENT_RE.test(p))) continue
      edges.push({
        constraintName: String(r.CONSTRAINT_NAME),
        table,
        column: col,
        referencedTable: refTable,
        referencedColumn: refCol
      })
    }

    return { tables, edges }
  }

  async getSchemaSnapshot(connectionId: string, database: string): Promise<SqlSchemaSnapshot> {
    const pool = this.getPool(connectionId)
    const db = dbRef(database)
    const [objectRows, foreignKeyRows, routineRows] = await Promise.all([
      pool.request().query(
        `SELECT s.name AS OBJECT_SCHEMA, o.name AS OBJECT_NAME,
                CASE WHEN o.type = 'U' THEN 'table' ELSE 'view' END AS OBJECT_KIND,
                c.column_id, c.name AS COLUMN_NAME, ty.name AS DATA_TYPE,
                CASE WHEN ty.name IN ('nvarchar', 'nchar') AND c.max_length > 0 THEN c.max_length / 2 ELSE c.max_length END AS MAX_LENGTH,
                c.is_nullable AS IS_NULLABLE, dc.definition AS COLUMN_DEFAULT,
                CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS IS_PK,
                CASE WHEN fkc.parent_column_id IS NOT NULL THEN 1 ELSE 0 END AS IS_FK
         FROM ${db}.sys.objects o
         JOIN ${db}.sys.schemas s ON s.schema_id = o.schema_id
         JOIN ${db}.sys.columns c ON c.object_id = o.object_id
         JOIN ${db}.sys.types ty ON ty.user_type_id = c.user_type_id
         LEFT JOIN (
           SELECT ic.object_id, ic.column_id
           FROM ${db}.sys.indexes i
           JOIN ${db}.sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
           WHERE i.is_primary_key = 1
         ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
         LEFT JOIN ${db}.sys.foreign_key_columns fkc ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
         LEFT JOIN ${db}.sys.default_constraints dc ON dc.object_id = c.default_object_id
         WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
         ORDER BY s.name, o.name, c.column_id`
      ),
      pool.request().query(
        `SELECT fk.name AS CONSTRAINT_NAME,
                ps.name AS TABLE_SCHEMA, pt.name AS TABLE_NAME, pc.name AS COLUMN_NAME,
                rs.name AS REF_TABLE_SCHEMA, rt.name AS REF_TABLE_NAME, rc.name AS REF_COLUMN_NAME
         FROM ${db}.sys.foreign_keys fk
         JOIN ${db}.sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN ${db}.sys.tables pt ON pt.object_id = fkc.parent_object_id
         JOIN ${db}.sys.schemas ps ON ps.schema_id = pt.schema_id
         JOIN ${db}.sys.columns pc ON pc.object_id = pt.object_id AND pc.column_id = fkc.parent_column_id
         JOIN ${db}.sys.tables rt ON rt.object_id = fkc.referenced_object_id
         JOIN ${db}.sys.schemas rs ON rs.schema_id = rt.schema_id
         JOIN ${db}.sys.columns rc ON rc.object_id = rt.object_id AND rc.column_id = fkc.referenced_column_id
         ORDER BY fk.name, fkc.constraint_column_id`
      ),
      pool.request().query(
        `SELECT s.name AS ROUTINE_SCHEMA, o.name AS ROUTINE_NAME,
                CASE WHEN o.type IN ('P', 'PC') THEN 'procedure' ELSE 'function' END AS ROUTINE_KIND,
                p.parameter_id, p.name AS PARAMETER_NAME, ty.name AS DATA_TYPE,
                p.max_length AS MAX_LENGTH, p.is_output AS IS_OUTPUT
         FROM ${db}.sys.objects o
         JOIN ${db}.sys.schemas s ON s.schema_id = o.schema_id
         LEFT JOIN ${db}.sys.parameters p ON p.object_id = o.object_id AND p.parameter_id > 0
         LEFT JOIN ${db}.sys.types ty ON ty.user_type_id = p.user_type_id
         WHERE o.type IN ('P', 'PC', 'FN', 'IF', 'TF', 'FS', 'FT') AND o.is_ms_shipped = 0
         ORDER BY s.name, o.name, p.parameter_id`
      )
    ])

    const objectMap = new Map<string, SqlSchemaSnapshot['objects'][number]>()
    for (const row of objectRows.recordset) {
      const schema = String(row.OBJECT_SCHEMA)
      const objectName = String(row.OBJECT_NAME)
      const name = `${schema}.${objectName}`
      let object = objectMap.get(name)
      if (!object) {
        object = { name, schema, kind: String(row.OBJECT_KIND) === 'view' ? 'view' : 'table', columns: [] }
        objectMap.set(name, object)
      }
      const maxLength = row.MAX_LENGTH == null || Number(row.MAX_LENGTH) < 0 ? null : Number(row.MAX_LENGTH)
      const dataType = String(row.DATA_TYPE)
      object.columns.push({
        name: String(row.COLUMN_NAME),
        type: maxLength && ['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary'].includes(dataType.toLowerCase())
          ? `${dataType}(${maxLength})`
          : dataType,
        maxLength,
        nullable: Boolean(row.IS_NULLABLE),
        isPrimaryKey: Number(row.IS_PK) === 1,
        isForeignKey: Number(row.IS_FK) === 1,
        defaultValue: row.COLUMN_DEFAULT == null ? null : String(row.COLUMN_DEFAULT)
      })
    }

    const foreignKeys: SqlForeignKeyEdge[] = foreignKeyRows.recordset.map(row => ({
      constraintName: String(row.CONSTRAINT_NAME),
      table: `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`,
      column: String(row.COLUMN_NAME),
      referencedTable: `${row.REF_TABLE_SCHEMA}.${row.REF_TABLE_NAME}`,
      referencedColumn: String(row.REF_COLUMN_NAME)
    }))

    const routineMap = new Map<string, SqlSchemaSnapshot['routines'][number]>()
    for (const row of routineRows.recordset) {
      const schema = String(row.ROUTINE_SCHEMA)
      const name = `${schema}.${row.ROUTINE_NAME}`
      let routine = routineMap.get(name)
      if (!routine) {
        routine = { name, schema, kind: String(row.ROUTINE_KIND) === 'procedure' ? 'procedure' : 'function', parameters: [] }
        routineMap.set(name, routine)
      }
      if (row.PARAMETER_NAME) {
        const maxLength = row.MAX_LENGTH == null || Number(row.MAX_LENGTH) <= 0 ? null : Number(row.MAX_LENGTH)
        const baseType = String(row.DATA_TYPE || 'sql_variant')
        routine.parameters.push({
          name: String(row.PARAMETER_NAME),
          type: maxLength && /^(?:n?varchar|n?char|varbinary|binary)$/i.test(baseType) ? `${baseType}(${maxLength})` : baseType,
          output: Boolean(row.IS_OUTPUT)
        })
      }
    }

    return {
      database,
      loadedAt: Date.now(),
      objects: [...objectMap.values()],
      foreignKeys,
      routines: [...routineMap.values()]
    }
  }
}
