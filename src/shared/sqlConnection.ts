export interface SqlServerTarget {
  host: string
  instanceName?: string
  port?: number
  isLocalDb: boolean
}

export function parseSqlServerTarget(value: string): SqlServerTarget {
  let server = value.trim()
  const isLocalDb = /^\(localdb\)/i.test(server)
  if (isLocalDb) {
    const instanceName = server.replace(/^\(localdb\)\\*/i, '').replace(/\\+$/, '').trim() || 'MSSQLLocalDB'
    return { host: '(localdb)', instanceName, isLocalDb: true }
  }

  server = server.replace(/^tcp:/i, '').trim()
  const portMatch = /,\s*(\d+)\s*$/.exec(server)
  const port = portMatch ? Number(portMatch[1]) : undefined
  if (portMatch) server = server.slice(0, portMatch.index).trim()
  const slash = server.indexOf('\\')
  if (slash >= 0) {
    const host = server.slice(0, slash).trim()
    const instanceName = server.slice(slash + 1).replace(/^\\+/, '').trim()
    return { host, ...(instanceName ? { instanceName } : {}), ...(port ? { port } : {}), isLocalDb: false }
  }
  return { host: server, ...(port ? { port } : {}), isLocalDb: false }
}

export function normalizeSqlConnectionConfig<T extends { server: string; encrypt?: boolean; port?: number }>(config: T): T {
  const target = parseSqlServerTarget(config.server)
  if (!target.isLocalDb) return config
  return {
    ...config,
    server: `(localdb)\\${target.instanceName || 'MSSQLLocalDB'}`,
    encrypt: false,
    port: undefined
  }
}

/** Stored/UI/connection-string timeout values are seconds; mssql expects milliseconds. */
export function sqlTimeoutMilliseconds(seconds: number | undefined, fallbackMilliseconds: number): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return fallbackMilliseconds
  return Math.max(1_000, Math.round(seconds * 1_000))
}

export interface ConnectablePool {
  connect(): Promise<unknown>
  close(): Promise<unknown>
}

function errorCodes(error: unknown): string[] {
  const codes: string[] = []
  let current = error as { code?: unknown; originalError?: unknown; cause?: unknown } | null
  const seen = new Set<unknown>()
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if (typeof current.code === 'string') codes.push(current.code.toUpperCase())
    current = (current.originalError || current.cause) as typeof current
  }
  return codes
}

export function isTransientConnectionError(error: unknown): boolean {
  const transientCodes = new Set(['EPIPE', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET', 'ETIMEOUT', 'ECONNCLOSED'])
  if (errorCodes(error).some(code => transientCodes.has(code))) return true
  const message = error instanceof Error ? error.message : String(error)
  return /\b(?:EPIPE|ECONNRESET|ECONNREFUSED|ESOCKET|ETIMEOUT)\b|connection lost|socket hang up/i.test(message)
}

export async function connectPoolWithRetry<T extends ConnectablePool>(
  factory: (attempt: number) => T,
  options: { maxAttempts?: number; delayMs?: number } = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2)
  const delayMs = Math.max(0, options.delayMs ?? 120)
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const pool = factory(attempt)
    try {
      await pool.connect()
      return pool
    } catch (error) {
      lastError = error
      try { await pool.close() } catch { /* preserve the connection error */ }
      if (attempt >= maxAttempts || !isTransientConnectionError(error)) throw error
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}
