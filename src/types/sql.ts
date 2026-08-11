export interface SqlConnection {
  id: string
  server: string
  database?: string
  user?: string
  password?: string
  port?: number
  isConnected: boolean
  label: string
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

export interface SqlConnectionConfig {
  server: string
  database?: string
  user?: string
  password?: string
  port?: number
  trustServerCertificate?: boolean
  connectionId?: string
}
