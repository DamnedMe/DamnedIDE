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

export type SqlSchemaObjectKind = 'table' | 'view'

export interface SqlSchemaObject {
  name: string
  schema: string
  kind: SqlSchemaObjectKind
  columns: SqlColumnInfo[]
}

export interface SqlRoutineParameter {
  name: string
  type: string
  output: boolean
}

export interface SqlRoutineInfo {
  name: string
  schema: string
  kind: 'procedure' | 'function'
  parameters: SqlRoutineParameter[]
}

export interface SqlSchemaSnapshot {
  database: string
  loadedAt: number
  objects: SqlSchemaObject[]
  foreignKeys: SqlForeignKeyEdge[]
  routines: SqlRoutineInfo[]
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

export type SqlQuerySource = 'editor' | 'context-menu' | 'diagram' | 'grid' | 'foreign-key' | 'mutation' | 'history' | 'favorite'

export interface SqlWorkspaceTab {
  id: string
  title: string
  query: string
  context?: { connectionId?: string; database?: string }
  dirty: boolean
  gridQueryState?: SqlGridQueryState
}

export interface SqlHistoryEntry {
  id: string
  query: string
  connectionId: string
  database?: string
  status: 'success' | 'error' | 'canceled'
  executedAt: number
  durationMs: number
  rowCount: number
  source: SqlQuerySource
  error?: string
  runCount: number
}

export interface SqlFavoriteQuery {
  id: string
  title: string
  query: string
  connectionId?: string
  database?: string
  createdAt: number
}

export interface SqlWorkspaceState {
  version: 1
  tabs: SqlWorkspaceTab[]
  activeTabId: string | null
  history: SqlHistoryEntry[]
  favorites: SqlFavoriteQuery[]
}

export type SqlGridFilterOperator = 'eq' | 'neq' | 'contains' | 'startsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'isNull' | 'isNotNull'

export interface SqlGridFilter {
  column: string
  dataType: string
  operator: SqlGridFilterOperator
  value?: string
  secondValue?: string
}

export interface SqlGridSort {
  column: string
  direction: 'asc' | 'desc'
}

export interface SqlGridQueryState {
  baseQuery: string
  filters: SqlGridFilter[]
  sorts: SqlGridSort[]
  lastGeneratedQuery: string
}
