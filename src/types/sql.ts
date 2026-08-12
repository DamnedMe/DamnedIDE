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

export interface SqlConnection {
  id: string
  server: string
  database?: string
  user?: string
  password?: string
  port?: number
  isConnected: boolean
  label: string
  authType?: SqlAuthType
  domain?: string
  tenantId?: string
  clientId?: string
  clientSecret?: string
  accessToken?: string
  encrypt?: boolean
  trustServerCertificate?: boolean
  connectTimeout?: number
  requestTimeout?: number
  protocol?: SqlProtocol
  lastConnected?: number
}

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
  connectTimeout?: number
  requestTimeout?: number
  protocol?: SqlProtocol
  /** renderer-only: when false the password is not persisted in the saved connection */
  rememberPassword?: boolean
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

export interface SqlTestResult {
  ok: boolean
  error?: string
  version?: string
}

export interface SqlServerInfo {
  version: string
  server: string
  database: string
}

export interface SqlRecentConnection {
  server: string
  database?: string
  user?: string
  authType?: SqlAuthType
  lastConnected: number
}
