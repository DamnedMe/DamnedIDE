import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

type WorkspaceTab = {
  id: string
  title: string
  query: string
  context?: { connectionId?: string; database?: string }
  dirty: boolean
  filePath?: string
  gridQueryState?: unknown
}

type HistoryEntry = {
  id: string
  query: string
  connectionId: string
  database?: string
  status: 'success' | 'error' | 'canceled'
  executedAt: number
  durationMs: number
  rowCount: number
  source: string
  error?: string
  runCount: number
}

export interface SqlWorkspaceDocument {
  version: 1
  tabs: WorkspaceTab[]
  activeTabId: string | null
  history: HistoryEntry[]
  favorites: Array<{ id: string; title: string; query: string; connectionId?: string; database?: string; createdAt: number }>
}

const MAX_HISTORY_PER_CONNECTION = 500
const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

function emptyWorkspace(): SqlWorkspaceDocument {
  return { version: 1, tabs: [], activeTabId: null, history: [], favorites: [] }
}

export function normalizeSqlWorkspace(input: unknown, now = Date.now()): SqlWorkspaceDocument {
  if (!input || typeof input !== 'object') return emptyWorkspace()
  const value = input as Partial<SqlWorkspaceDocument>
  const tabs = Array.isArray(value.tabs)
    ? value.tabs.filter(tab => tab && typeof tab.id === 'string' && typeof tab.query === 'string').map(tab => ({
        id: tab.id,
        title: typeof tab.title === 'string' && tab.title.trim() ? tab.title.slice(0, 120) : 'Query',
        query: tab.query,
        context: tab.context && typeof tab.context === 'object' ? {
          connectionId: typeof tab.context.connectionId === 'string' ? tab.context.connectionId : undefined,
          database: typeof tab.context.database === 'string' ? tab.context.database : undefined
        } : undefined,
        dirty: Boolean(tab.dirty),
        filePath: typeof tab.filePath === 'string' ? tab.filePath : undefined,
        gridQueryState: tab.gridQueryState && typeof tab.gridQueryState === 'object' ? tab.gridQueryState : undefined
      }))
    : []
  const cutoff = now - HISTORY_RETENTION_MS
  const perConnection = new Map<string, number>()
  const history = (Array.isArray(value.history) ? value.history : [])
    .filter(entry => entry && typeof entry.query === 'string' && typeof entry.connectionId === 'string' && Number(entry.executedAt) >= cutoff)
    .sort((left, right) => Number(right.executedAt) - Number(left.executedAt))
    .filter(entry => {
      const count = perConnection.get(entry.connectionId) || 0
      if (count >= MAX_HISTORY_PER_CONNECTION) return false
      perConnection.set(entry.connectionId, count + 1)
      return true
    })
    .map(entry => ({
      id: String(entry.id || crypto.randomUUID()), query: entry.query, connectionId: entry.connectionId,
      database: typeof entry.database === 'string' ? entry.database : undefined,
      status: (entry.status === 'error' || entry.status === 'canceled' ? entry.status : 'success') as HistoryEntry['status'],
      executedAt: Number(entry.executedAt), durationMs: Number(entry.durationMs) || 0,
      rowCount: Number(entry.rowCount) || 0, source: String(entry.source || 'editor'),
      error: typeof entry.error === 'string' ? entry.error.slice(0, 500) : undefined,
      runCount: Math.max(1, Number(entry.runCount) || 1)
    }))
  const favorites = (Array.isArray(value.favorites) ? value.favorites : [])
    .filter(item => item && typeof item.id === 'string' && typeof item.query === 'string')
    .map(item => ({
      id: item.id, title: typeof item.title === 'string' && item.title.trim() ? item.title.slice(0, 120) : 'Saved query',
      query: item.query, connectionId: typeof item.connectionId === 'string' ? item.connectionId : undefined,
      database: typeof item.database === 'string' ? item.database : undefined,
      createdAt: Number(item.createdAt) || now
    }))
  const activeTabId = typeof value.activeTabId === 'string' && tabs.some(tab => tab.id === value.activeTabId)
    ? value.activeTabId
    : tabs[0]?.id || null
  return { version: 1, tabs, activeTabId, history, favorites }
}

export class SqlWorkspaceService {
  private readonly filePath: string
  private writeQueue = Promise.resolve()

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, 'sql', 'workspace.v1.json')
  }

  async load(): Promise<SqlWorkspaceDocument> {
    try {
      return normalizeSqlWorkspace(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch {
      return emptyWorkspace()
    }
  }

  save(value: SqlWorkspaceDocument): Promise<void> {
    const normalized = normalizeSqlWorkspace(value)
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.tmp`
      await writeFile(temporary, JSON.stringify(normalized, null, 2), 'utf8')
      await rename(temporary, this.filePath)
    })
    return this.writeQueue
  }
}
