import { ConnectionPool, config as sqlConfig, IResult } from 'mssql'
import net from 'net'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export interface SqlConnectionConfig {
  server: string
  database?: string
  user?: string
  password?: string
  port?: number
  trustServerCertificate?: boolean
  connectionId?: string
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

export interface SqlForeignKeyInfo {
  column: string
  table: string
  referencedTable: string
  referencedColumn: string
}

function colTypeName(colMeta: { type?: unknown } | undefined): string {
  let t = colMeta?.type
  if (typeof t === 'function') t = (t as () => unknown)()
  const jsType = (t as { type?: unknown } | undefined)?.type
  if (jsType === Date) return 'date'
  if (jsType === Number) return 'number'
  if (jsType === Boolean) return 'boolean'
  if (jsType === Buffer) return 'binary'
  if (jsType === BigInt) return 'bigint'
  if (jsType === String) return 'string'
  return 'other'
}

const IDENT_RE = /^[A-Za-z0-9_]+$/

// Lightweight table extraction from the query (comments and string literals stripped).
function extractTables(query: string): { schema: string; name: string }[] {
  const cleaned = query
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/'[^']*'/g, ' ')
  const tables: { schema: string; name: string }[] = []
  const re = /(?:FROM|JOIN)\s+\[?([A-Za-z0-9_]+)\]?(?:\s*\.\s*\[?([A-Za-z0-9_]+)\]?)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned))) {
    const first = m[1]
    const second = m[2]
    const schema = second ? first : 'dbo'
    const name = second ? second : first
    if (IDENT_RE.test(schema) && IDENT_RE.test(name)) tables.push({ schema, name })
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
  // Common direct paths (SQL Server 2016+)
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

/**
 * Reads the LocalDB instance pipe name from the registry (value names are always
 * English regardless of OS language). Prefers the requested instance name.
 */
function pipeFromRegistry(instance: string): string | null {
  try {
    const out = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Microsoft SQL Server\\UserInstances" /s',
      { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    )
    // Split into per-instance blocks
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

  const instance = s.includes('\\')
    ? s.split('\\').slice(1).join('\\').trim()
    : 'MSSQLLocalDB'

  // 1) Registry (language-independent)
  const regPipe = pipeFromRegistry(instance)
  if (regPipe) return regPipe

  // 2) SqlLocalDB.exe as fallback, extracting any line containing LOCALDB#
  const sqllocaldb = findSqlLocalDb()
  if (!sqllocaldb) {
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
    console.error('[sql] LocalDB pipe risolto:', pipeName)
    return pipeName
  } catch (e) {
    console.error('[sql] risoluzione LocalDB fallita:', (e as Error).message)
    return null
  }
}

export class SqlService {
  private connections: Map<string, ConnectionPool> = new Map()
  private counter: number = 0

  async connect(config: SqlConnectionConfig): Promise<string> {
    const id = config.connectionId || `conn_${++this.counter}`
    const isLocalDb = /^\(localdb\)/i.test((config.server || '').trim())
    const pipe = resolveLocalDbPipe(config.server)
    let poolConfig: sqlConfig

    if (pipe) {
      // LocalDB via named pipe (custom connector)
      poolConfig = {
        server: 'localhost',
        port: config.port || 1433,
        database: config.database,
        user: config.user,
        password: config.password,
        options: {
          trustServerCertificate: true,
          encrypt: false,
          // Runtime signature is (connectOpts, lookup, signal); the TS type is
          // narrower, so cast it.
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
    } else if (isLocalDb) {
      // LocalDB pipe not resolvable: fall back to a local TCP SQL Server
      poolConfig = {
        server: 'localhost',
        database: config.database,
        user: config.user,
        password: config.password,
        port: config.port || 1433,
        options: {
          trustServerCertificate: config.trustServerCertificate ?? true,
          encrypt: true
        }
      }
    } else {
      poolConfig = {
        server: config.server,
        database: config.database,
        user: config.user,
        password: config.password,
        port: config.port || 1433,
        options: {
          trustServerCertificate: config.trustServerCertificate ?? true,
          encrypt: true
        }
      }
    }

    const pool = new ConnectionPool(poolConfig)
    await pool.connect()
    this.connections.set(id, pool)
    return id
  }

  async disconnect(connectionId: string): Promise<void> {
    const pool = this.connections.get(connectionId)
    if (pool) {
      await pool.close()
      this.connections.delete(connectionId)
    }
  }

  async executeQuery(connectionId: string, query: string): Promise<SqlQueryResult> {
    const pool = this.connections.get(connectionId)
    if (!pool) throw new Error('Connessione non trovata')

    const result: IResult<Record<string, unknown>> = await pool.request().query(query)
    const colsMeta = result.recordset.columns ? Object.values(result.recordset.columns) : []
    const columns = colsMeta.map(c => c.name)
    const colTypes: Record<string, string> = {}
    for (const c of colsMeta) colTypes[c.name] = colTypeName(c)

    // PK/FK detection: query the INFORMATION_SCHEMA once and filter on the tables
    // referenced by the user query (best-effort heuristic).
    const primaryKeys: string[] = []
    const foreignKeys: string[] = []
    const foreignKeyInfo: SqlForeignKeyInfo[] = []
    const tables = extractTables(query)

    // Ordered columns of the base (FROM) table: used to draw a visual divider where
    // the LEFT JOINed columns start in the result set.
    let baseTableColumns: string[] = []
    if (tables.length > 0) {
      const base = tables[0]
      try {
        const colRes = await pool.request().query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = '${base.schema}' AND TABLE_NAME = '${base.name}'
           ORDER BY ORDINAL_POSITION`
        )
        baseTableColumns = colRes.recordset.map(r => String(r.COLUMN_NAME))
      } catch { /* metadata failure ignored */ }
    }

    if (tables.length > 0) {
      try {
        const meta = await pool.request().query(
          `SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME, tc.CONSTRAINT_TYPE
           FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
           JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
             ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
            AND tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
           WHERE tc.CONSTRAINT_TYPE IN ('PRIMARY KEY','FOREIGN KEY')`
        )
        const names = new Set(tables.map(t => t.name.toLowerCase()))
        for (const r of meta.recordset) {
          if (!names.has(String(r.TABLE_NAME).toLowerCase())) continue
          const col = String(r.COLUMN_NAME)
          if (r.CONSTRAINT_TYPE === 'PRIMARY KEY') primaryKeys.push(col)
          else if (r.CONSTRAINT_TYPE === 'FOREIGN KEY') foreignKeys.push(col)
        }
      } catch { /* metadata failure ignored */ }

      // Referenced table/column for each FK, used to build LEFT JOINs on demand.
      try {
        const fkRes = await pool.request().query(
          `SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME,
                  rkcu.TABLE_SCHEMA AS REF_TABLE_SCHEMA, rkcu.TABLE_NAME AS REF_TABLE_NAME, rkcu.COLUMN_NAME AS REF_COLUMN_NAME
           FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
           JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
             ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
            AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
           JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE rkcu
             ON rkcu.CONSTRAINT_NAME = rc.UNIQUE_CONSTRAINT_NAME
            AND rkcu.CONSTRAINT_SCHEMA = rc.UNIQUE_CONSTRAINT_SCHEMA`
        )
        const names = new Set(tables.map(t => t.name.toLowerCase()))
        for (const r of fkRes.recordset) {
          if (!names.has(String(r.TABLE_NAME).toLowerCase())) continue
          const col = String(r.COLUMN_NAME)
          const refCol = String(r.REF_COLUMN_NAME)
          const table = `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`
          const refTable = `${r.REF_TABLE_SCHEMA}.${r.REF_TABLE_NAME}`
          // only valid, fully-qualified identifiers (never build `ON fk1. = ...`)
          const parts = [col, refCol, ...table.split('.'), ...refTable.split('.')]
          if (!parts.every(p => IDENT_RE.test(p))) continue
          foreignKeyInfo.push({ column: col, table, referencedTable: refTable, referencedColumn: refCol })
        }
      } catch { /* metadata failure ignored */ }
    }

    return {
      columns,
      rows: result.recordset as Record<string, unknown>[],
      rowCount: result.rowsAffected?.[0] ?? result.recordset.length,
      colTypes,
      primaryKeys,
      foreignKeys,
      foreignKeyInfo,
      baseTableColumns
    }
  }

  async listDatabases(connectionId: string): Promise<string[]> {
    const result = await this.executeQuery(connectionId, 'SELECT name FROM sys.databases ORDER BY name')
    return result.rows.map(r => r.name as string)
  }

  async listTables(connectionId: string, database: string): Promise<string[]> {
    const result = await this.executeQuery(
      connectionId,
      `SELECT TABLE_SCHEMA + '.' + TABLE_NAME AS fullName
       FROM ${database}.INFORMATION_SCHEMA.TABLES
       WHERE TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_SCHEMA, TABLE_NAME`
    )
    return result.rows.map(r => r.fullName as string)
  }
}
