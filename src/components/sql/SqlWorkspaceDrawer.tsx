import { useMemo, useState } from 'react'
import { Clock3, FileText, Heart, HeartOff, Pencil, Plus, Search, Trash2, X } from '@/components/icons'
import { SqlFavoriteQuery, SqlHistoryEntry, SqlQuerySource, SqlWorkspaceState } from '../../types/sql'
import { tr, useI18n } from '../../i18n'

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
  return query.replace(/\s+/g, ' ').trim().slice(0, 76) || tr('Empty query')
}

/** Where a history entry was run from, as shown; the stored value stays the enum. */
function sourceLabel(source: SqlQuerySource, t: (key: string) => string): string {
  switch (source) {
    case 'editor': return t('editor')
    case 'context-menu': return t('context menu')
    case 'diagram': return t('diagram')
    case 'grid': return t('grid')
    case 'foreign-key': return t('foreign key')
    case 'mutation': return t('data change')
    case 'history': return t('history')
    case 'favorite': return t('favorite')
    default: return source // a value saved by another version: shown as stored
  }
}

function tinyButton(active = false): React.CSSProperties {
  return {
    height: 24, padding: '0 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
    border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`,
    color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
    background: active ? 'var(--accent-bg)' : 'transparent', fontFamily: 'var(--font-mono)', fontSize: 'calc(9px * var(--ui-text-scale, 1))'
  }
}

export function SqlWorkspaceDrawer({
  workspace, onClose, onOpenQuery, onFavoriteHistory, onRemoveFavorite,
  onDeleteHistory, onClearHistory, onRenameTab, onRenameFavorite, onNewQuery, onActivateTab
}: SqlWorkspaceDrawerProps) {
  const t = useI18n()
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
    <aside className="sql-workspace-drawer" role="complementary" aria-label={t('SQL workspace')} style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(390px, 42vw)', zIndex: 40,
      display: 'flex', flexDirection: 'column', background: 'var(--bg-card)',
      borderLeft: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--font-mono)'
    }}>
      <header className="sql-workspace-drawer__header" style={{ height: 42, display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: '1px solid var(--border-subtle)', gap: 7 }}>
        <Clock3 size={13} color="var(--accent-color)" />
        <strong style={{ flex: 1, fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600 }}>{t('SQL workspace')}</strong>
        <button aria-label={t('close SQL workspace')} title={t('close')} data-tip-desc={t('close the SQL workspace drawer')} onClick={onClose} style={tinyButton()}><X size={11} /></button>
      </header>

      <nav className="sql-workspace-drawer__tabs" aria-label={t('SQL workspace sections')} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', padding: '7px 8px 0', gap: 4 }}>
        {(['workspace', 'history', 'favorites'] as Section[]).map(value => (
          <button key={value} aria-label={t(value)} onClick={() => setSection(value)} style={tinyButton(section === value)}>{t(value)}</button>
        ))}
      </nav>

      {section === 'workspace' && (
        <div style={{ padding: '8px 8px 0' }}>
          <button aria-label={t('add query to workspace')} onClick={onNewQuery} style={{
            ...tinyButton(true), width: '100%', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontWeight: 600
          }}><Plus size={11} /> {t('new query')}</button>
        </div>
      )}

      <div style={{ padding: '8px', display: 'flex', gap: 5 }}>
        <label style={{ position: 'relative', flex: 1 }}>
          <Search size={10} style={{ position: 'absolute', left: 7, top: 7, color: 'var(--text-muted)' }} />
          <input aria-label={t('search SQL workspace')} value={search} onChange={event => setSearch(event.target.value)} placeholder={t('Search SQL or database…')} style={{
            width: '100%', height: 26, padding: '0 7px 0 23px', background: 'var(--bg-input)', color: 'var(--text-primary)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', outline: 'none', fontSize: 'calc(9px * var(--ui-text-scale, 1))'
          }} />
        </label>
      </div>

      {section === 'history' && (
        <div style={{ display: 'flex', gap: 5, padding: '0 8px 7px' }}>
          <select aria-label={t('history status')} value={status} onChange={event => setStatus(event.target.value as typeof status)} style={{ ...tinyButton(), flex: 1 }}>
            <option value="all">{t('all statuses')}</option><option value="success">{t('success')}</option><option value="error">{t('error')}</option><option value="canceled">{t('canceled')}</option>
          </select>
          <select aria-label={t('history period')} value={period} onChange={event => setPeriod(event.target.value as typeof period)} style={{ ...tinyButton(), flex: 1 }}>
            <option value="all">{t('all time')}</option><option value="day">{t('24 hours')}</option><option value="week">{t('7 days')}</option><option value="month">{t('30 days')}</option>
          </select>
          {workspace.history.length > 0 && <button aria-label={t('clear query history')} title={t('clear history')} data-tip-desc={t('delete the entire query history')} onClick={onClearHistory} style={tinyButton()}><Trash2 size={10} /></button>}
        </div>
      )}

      <div style={{ overflow: 'auto', flex: 1, padding: '0 8px 12px' }}>
        {section === 'workspace' && workspace.tabs.map(tab => (
          <article key={tab.id} style={{ padding: '9px', borderBottom: '1px solid var(--border-subtle)' }}>
            {editingTab === tab.id ? (
              <input autoFocus aria-label={t('rename {title}', { title: tab.title })} value={draftTitle} onChange={event => setDraftTitle(event.target.value)}
                onBlur={() => { onRenameTab(tab.id, draftTitle); setEditingTab(null) }}
                onKeyDown={event => { if (event.key === 'Enter') { onRenameTab(tab.id, draftTitle); setEditingTab(null) } if (event.key === 'Escape') setEditingTab(null) }}
                style={{ width: '100%', height: 25, padding: '0 6px', background: 'var(--bg-input)', border: '1px solid var(--accent-color)', color: 'var(--text-primary)', borderRadius: 3 }} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <button aria-label={t('open {title}', { title: tab.title })} onClick={() => onActivateTab(tab.id)} style={{
                  border: 0, padding: 0, flex: 1, textAlign: 'left', background: 'transparent', color: 'var(--text-primary)',
                  cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 600
                }}>{tab.title}</button>
                <button aria-label={t('rename {title}', { title: tab.title })} title={t('rename query')} data-tip-desc={t('rename the current query')} onClick={() => { setDraftTitle(tab.title); setEditingTab(tab.id) }} style={tinyButton()}><Pencil size={9} /></button>
              </div>
            )}
            <div style={{ color: 'var(--text-muted)', fontSize: 'calc(8.5px * var(--ui-text-scale, 1))', marginTop: 4 }}>{tab.context?.database || t('no database')} · {queryTitle(tab.query)}</div>
          </article>
        ))}

        {section === 'history' && history.map(entry => (
          <article data-testid="sql-history-item" key={entry.id} style={{ padding: '9px', borderBottom: '1px solid var(--border-subtle)' }}>
            <button aria-label={t('open {title}', { title: queryTitle(entry.query) })} onClick={() => onOpenQuery(entry.query, { connectionId: entry.connectionId, database: entry.database }, 'history')}
              style={{ border: 0, padding: 0, width: '100%', textAlign: 'left', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', lineHeight: 1.45 }}>
              {queryTitle(entry.query)}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 'calc(8px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>
              <span style={{ color: entry.status === 'success' ? 'var(--success-color)' : 'var(--error-color)' }}>{t(entry.status)}</span>
              <span>{entry.database || 'server'}</span><span>{sourceLabel(entry.source, t)}</span><span>{entry.durationMs} ms</span><span>{entry.rowCount === 1 ? t('1 row') : t('{n} rows', { n: entry.rowCount })}</span>
              {entry.runCount > 1 && <span>×{entry.runCount}</span>}
              <span style={{ flex: 1 }} />
              <button aria-label={t('add query to favorites')} title={t('add to favorites')} data-tip-desc={t('save this query to the favorites')} onClick={() => onFavoriteHistory(entry)} style={tinyButton()}><Heart size={9} /></button>
              <button aria-label={t('delete history entry')} title={t('delete')} data-tip-desc={t('delete this item')} onClick={() => onDeleteHistory(entry.id)} style={tinyButton()}><Trash2 size={9} /></button>
            </div>
          </article>
        ))}

        {section === 'favorites' && favorites.map((favorite: SqlFavoriteQuery) => (
          <article data-testid="sql-favorite-item" key={favorite.id} style={{ padding: '9px', borderBottom: '1px solid var(--border-subtle)' }}>
            {editingFavorite === favorite.id ? (
              <input autoFocus aria-label={t('rename favorite {title}', { title: favorite.title })} value={draftTitle} onChange={event => setDraftTitle(event.target.value)}
                onBlur={() => { onRenameFavorite(favorite.id, draftTitle); setEditingFavorite(null) }}
                onKeyDown={event => { if (event.key === 'Enter') { onRenameFavorite(favorite.id, draftTitle); setEditingFavorite(null) } if (event.key === 'Escape') setEditingFavorite(null) }}
                style={{ width: '100%', height: 25, padding: '0 6px', background: 'var(--bg-input)', border: '1px solid var(--accent-color)', color: 'var(--text-primary)', borderRadius: 3 }} />
            ) : (
              <button aria-label={t('rename favorite {title}', { title: favorite.title })} onClick={() => { setDraftTitle(favorite.title); setEditingFavorite(favorite.id) }} style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--text-primary)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 600, cursor: 'text' }}>{favorite.title}</button>
            )}
            <div style={{ fontSize: 'calc(8.5px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', margin: '4px 0 7px' }}>{queryTitle(favorite.query)}</div>
            <div style={{ display: 'flex', gap: 5 }}>
              <button aria-label={t('open {title}', { title: favorite.title })} onClick={() => onOpenQuery(favorite.query, { connectionId: favorite.connectionId, database: favorite.database }, 'favorite')} style={tinyButton(true)}><FileText size={9} /> {t('open')}</button>
              <button aria-label={t('remove {title} from favorites', { title: favorite.title })} title={t('remove favorite')} data-tip-desc={t('remove this query from the favorites')} onClick={() => onRemoveFavorite(favorite.id)} style={tinyButton()}><HeartOff size={9} /></button>
            </div>
          </article>
        ))}

        {((section === 'history' && history.length === 0) || (section === 'favorites' && favorites.length === 0) || (section === 'workspace' && workspace.tabs.length === 0)) && (
          <div style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(9px * var(--ui-text-scale, 1))' }}>{t('No matching items')}</div>
        )}
      </div>
    </aside>
  )
}
