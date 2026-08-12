import { SqlFavoriteQuery, SqlHistoryEntry, SqlWorkspaceState, SqlWorkspaceTab } from '../../types/sql'

export const EMPTY_SQL_WORKSPACE: SqlWorkspaceState = {
  version: 1,
  tabs: [],
  activeTabId: null,
  history: [],
  favorites: []
}

export function updateWorkspaceTabs(workspace: SqlWorkspaceState, tabs: SqlWorkspaceTab[], activeTabId: string): SqlWorkspaceState {
  return { ...workspace, tabs, activeTabId }
}

export function addHistoryEntry(workspace: SqlWorkspaceState, entry: Omit<SqlHistoryEntry, 'id' | 'runCount'>): SqlWorkspaceState {
  const previous = workspace.history[0]
  let history: SqlHistoryEntry[]
  if (previous && previous.query.trim() === entry.query.trim() && previous.connectionId === entry.connectionId && previous.database === entry.database) {
    history = [{ ...previous, ...entry, runCount: previous.runCount + 1 }, ...workspace.history.slice(1)]
  } else {
    history = [{ ...entry, id: crypto.randomUUID(), runCount: 1 }, ...workspace.history]
  }

  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
  const perConnection = new Map<string, number>()
  history = history.filter(item => {
    if (item.executedAt < cutoff) return false
    const count = perConnection.get(item.connectionId) ?? 0
    if (count >= 500) return false
    perConnection.set(item.connectionId, count + 1)
    return true
  })
  return { ...workspace, history }
}

export function favoriteHistoryEntry(workspace: SqlWorkspaceState, entry: SqlHistoryEntry): SqlWorkspaceState {
  const existing = workspace.favorites.find(item => item.query.trim() === entry.query.trim() && item.connectionId === entry.connectionId && item.database === entry.database)
  if (existing) return workspace
  const title = entry.query.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Saved query'
  const favorite: SqlFavoriteQuery = {
    id: crypto.randomUUID(), title, query: entry.query, connectionId: entry.connectionId,
    database: entry.database, createdAt: Date.now()
  }
  return { ...workspace, favorites: [favorite, ...workspace.favorites] }
}
