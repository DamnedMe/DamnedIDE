import { useMemo, useState } from 'react'
import { Clock3, FileText, Heart, HeartOff, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { SqlFavoriteQuery, SqlHistoryEntry, SqlWorkspaceState } from '../../types/sql'

interface SqlWorkspaceDrawerProps {
  workspace: SqlWorkspaceState
  onClose: () => void
  onOpenQuery: (query: string, context: { connectionId?: string; database?: string }, source: 'history' | 'favorite') => void
  onFavoriteHistory: (entry: SqlHistoryEntry) => void
  onRemoveFavorite: (id: string) => void
  onDeleteHistory: (id: string) => void
  onClearHistory: () => void
  onRenameTab: (id: string, title: string) => void
  onRenameFavorite: (id: string, title: string) => void
  onNewQuery: () => void
  onActivateTab: (id: string) => void
}

type Section = 'workspace' | 'history' | 'favorites'

function queryTitle(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, 76) || 'Empty query'
}

function tinyButton(active = false): React.CSSProperties {
  return {
    height: 24, padding: '0 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
    border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`,
    color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
    background: active ? 'var(--accent-bg)' : 'transparent', fontFamily: 'var(--font-mono)', fontSize: 9
  }
}

export function SqlWorkspaceDrawer({
  workspace, onClose, onOpenQuery, onFavoriteHistory, onRemoveFavorite,
  onDeleteHistory, onClearHistory, onRenameTab, onRenameFavorite, onNewQuery, onActivateTab
}: SqlWorkspaceDrawerProps) {
  const [section, setSection] = useState<Section>('history')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | SqlHistoryEntry['status']>('all')
  const [period, setPeriod] = useState<'all' | 'day' | 'week' | 'month'>('all')
  const [editingTab, setEditingTab] = useState<string | null>(null)
  const [editingFavorite, setEditingFavorite] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const history = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    const age = period === 'day' ? 86_400_000 : period === 'week' ? 604_800_000 : period === 'month' ? 2_592_000_000 : Infinity
    return workspace.history.filter(entry => {
      if (status !== 'all' && entry.status !== status) return false
      if (Date.now() - entry.executedAt > age) return false
      return !term || entry.query.toLocaleLowerCase().includes(term) || (entry.database || '').toLocaleLowerCase().includes(term)
    })
  }, [period, search, status, workspace.history])

  const favorites = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return workspace.favorites.filter(item => !term || item.title.toLocaleLowerCase().includes(term) || item.query.toLocaleLowerCase().includes(term))
  }, [search, workspace.favorites])

  return (
    <aside role="complementary" aria-label="SQL workspace" style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(390px, 42vw)', zIndex: 40,
      display: 'flex', flexDirection: 'column', background: 'var(--bg-card)',
      borderLeft: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--font-mono)'
    }}>
      <header style={{ height: 42, display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: '1px solid var(--border-subtle)', gap: 7 }}>
        <Clock3 size={13} color="var(--accent-color)" />
        <strong style={{ flex: 1, fontSize: 11, fontWeight: 600 }}>SQL workspace</strong>
        <button aria-label="close SQL workspace" onClick={onClose} style={tinyButton()}><X size={11} /></button>
      </header>

      <nav aria-label="SQL workspace sections" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', padding: '7px 8px 0', gap: 4 }}>
        {(['workspace', 'history', 'favorites'] as Section[]).map(value => (
          <button key={value} aria-label={value} onClick={() => setSection(value)} style={tinyButton(section === value)}>{value}</button>
        ))}
      </nav>

      {section === 'workspace' && (
        <div style={{ padding: '8px 8px 0' }}>
          <button aria-label="add query to workspace" onClick={onNewQuery} style={{
            ...tinyButton(true), width: '100%', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontWeight: 600
          }}><Plus size={11} /> new query</button>
        </div>
      )}

      <div style={{ padding: '8px', display: 'flex', gap: 5 }}>
        <label style={{ position: 'relative', flex: 1 }}>
          <Search size={10} style={{ position: 'absolute', left: 7, top: 7, color: 'var(--text-muted)' }} />
          <input aria-label="search SQL workspace" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search SQL or database…" style={{
            width: '100%', height: 26, padding: '0 7px 0 23px', background: 'var(--bg-input)', color: 'var(--text-primary)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', outline: 'none', fontSize: 9
          }} />
        </label>
      </div>

      {section === 'history' && (
        <div style={{ display: 'flex', gap: 5, padding: '0 8px 7px' }}>
          <select aria-label="history status" value={status} onChange={event => setStatus(event.target.value as typeof status)} style={{ ...tinyButton(), flex: 1 }}>
            <option value="all">all statuses</option><option value="success">success</option><option value="error">error</option><option value="canceled">canceled</option>
          </select>
          <select aria-label="history period" value={period} onChange={event => setPeriod(event.target.value as typeof period)} style={{ ...tinyButton(), flex: 1 }}>
            <option value="all">all time</option><option value="day">24 hours</option><option value="week">7 days</option><option value="month">30 days</option>
          </select>
          {workspace.history.length > 0 && <button aria-label="clear query history" onClick={onClearHistory} style={tinyButton()}><Trash2 size={10} /></button>}
        </div>
      )}

      <div style={{ overflow: 'auto', flex: 1, padding: '0 8px 12px' }}>
        {section === 'workspace' && workspace.tabs.map(tab => (
          <article key={tab.id} style={{ padding: '9px', borderBottom: '1px solid var(--border-subtle)' }}>
            {editingTab === tab.id ? (
              <input autoFocus aria-label={`rename ${tab.title}`} value={draftTitle} onChange={event => setDraftTitle(event.target.value)}
                onBlur={() => { onRenameTab(tab.id, draftTitle); setEditingTab(null) }}
                onKeyDown={event => { if (event.key === 'Enter') { onRenameTab(tab.id, draftTitle); setEditingTab(null) } if (event.key === 'Escape') setEditingTab(null) }}
                style={{ width: '100%', height: 25, padding: '0 6px', background: 'var(--bg-input)', border: '1px solid var(--accent-color)', color: 'var(--text-primary)', borderRadius: 3 }} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <button aria-label={`open ${tab.title}`} onClick={() => onActivateTab(tab.id)} style={{
                  border: 0, padding: 0, flex: 1, textAlign: 'left', background: 'transparent', color: 'var(--text-primary)',
                  cursor: 'pointer', fontSize: 10, fontWeight: 600
                }}>{tab.title}</button>
                <button aria-label={`rename ${tab.title}`} title="rename query" onClick={() => { setDraftTitle(tab.title); setEditingTab(tab.id) }} style={tinyButton()}><Pencil size={9} /></button>
              </div>
            )}
            <div style={{ color: 'var(--text-muted)', fontSize: 8.5, marginTop: 4 }}>{tab.context?.database || 'no database'} · {queryTitle(tab.query)}</div>
          </article>
        ))}

        {section === 'history' && history.map(entry => (
          <article data-testid="sql-history-item" key={entry.id} style={{ padding: '9px', borderBottom: '1px solid var(--border-subtle)' }}>
            <button aria-label={`open ${queryTitle(entry.query)}`} onClick={() => onOpenQuery(entry.query, { connectionId: entry.connectionId, database: entry.database }, 'history')}
              style={{ border: 0, padding: 0, width: '100%', textAlign: 'left', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 9.5, lineHeight: 1.45 }}>
              {queryTitle(entry.query)}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 8, color: 'var(--text-muted)' }}>
              <span style={{ color: entry.status === 'success' ? 'var(--success-color)' : 'var(--error-color)' }}>{entry.status}</span>
              <span>{entry.database || 'server'}</span><span>{entry.source}</span><span>{entry.durationMs} ms</span><span>{entry.rowCount} rows</span>
              {entry.runCount > 1 && <span>×{entry.runCount}</span>}
              <span style={{ flex: 1 }} />
              <button aria-label="add query to favorites" title="add to favorites" onClick={() => onFavoriteHistory(entry)} style={tinyButton()}><Heart size={9} /></button>
              <button aria-label="delete history entry" title="delete" onClick={() => onDeleteHistory(entry.id)} style={tinyButton()}><Trash2 size={9} /></button>
            </div>
          </article>
        ))}

        {section === 'favorites' && favorites.map((favorite: SqlFavoriteQuery) => (
          <article data-testid="sql-favorite-item" key={favorite.id} style={{ padding: '9px', borderBottom: '1px solid var(--border-subtle)' }}>
            {editingFavorite === favorite.id ? (
              <input autoFocus aria-label={`rename favorite ${favorite.title}`} value={draftTitle} onChange={event => setDraftTitle(event.target.value)}
                onBlur={() => { onRenameFavorite(favorite.id, draftTitle); setEditingFavorite(null) }}
                onKeyDown={event => { if (event.key === 'Enter') { onRenameFavorite(favorite.id, draftTitle); setEditingFavorite(null) } if (event.key === 'Escape') setEditingFavorite(null) }}
                style={{ width: '100%', height: 25, padding: '0 6px', background: 'var(--bg-input)', border: '1px solid var(--accent-color)', color: 'var(--text-primary)', borderRadius: 3 }} />
            ) : (
              <button aria-label={`rename favorite ${favorite.title}`} onClick={() => { setDraftTitle(favorite.title); setEditingFavorite(favorite.id) }} style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--text-primary)', fontSize: 10, fontWeight: 600, cursor: 'text' }}>{favorite.title}</button>
            )}
            <div style={{ fontSize: 8.5, color: 'var(--text-muted)', margin: '4px 0 7px' }}>{queryTitle(favorite.query)}</div>
            <div style={{ display: 'flex', gap: 5 }}>
              <button aria-label={`open ${favorite.title}`} onClick={() => onOpenQuery(favorite.query, { connectionId: favorite.connectionId, database: favorite.database }, 'favorite')} style={tinyButton(true)}><FileText size={9} /> open</button>
              <button aria-label={`remove ${favorite.title} from favorites`} onClick={() => onRemoveFavorite(favorite.id)} style={tinyButton()}><HeartOff size={9} /></button>
            </div>
          </article>
        ))}

        {((section === 'history' && history.length === 0) || (section === 'favorites' && favorites.length === 0) || (section === 'workspace' && workspace.tabs.length === 0)) && (
          <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 9 }}>No matching items</div>
        )}
      </div>
    </aside>
  )
}
