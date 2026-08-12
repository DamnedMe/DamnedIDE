import { SqlConnection, SqlRecentConnection } from '../../types/sql'
import { Clock, Database, Plus } from 'lucide-react'
import { authShortLabel } from './sqlForm'

interface RecentConnectionsMenuProps {
  connections: SqlConnection[]
  recent: SqlRecentConnection[]
  onNew: () => void
  onOpenRecent: (r: SqlRecentConnection) => void
  onSelectSaved: (id: string) => void
  onClose: () => void
  anchor: { x: number; y: number }
}

export function RecentConnectionsMenu({ connections, recent, onNew, onOpenRecent, onSelectSaved, onClose, anchor }: RecentConnectionsMenuProps) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={onClose} />
      <div style={{
        position: 'fixed', left: Math.min(anchor.x, window.innerWidth - 320), top: anchor.y, zIndex: 300,
        width: '300px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
        fontFamily: 'var(--font-mono)', animation: 'menuIn 140ms ease'
      }}>
        <div style={{
          padding: '7px 12px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.5px', color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '6px'
        }}>
          <Clock size={10} /> recent connections
        </div>
        <div style={{ maxHeight: '200px', overflow: 'auto' }}>
          {recent.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: '10px', color: 'var(--text-muted)' }}>
              no recent connections yet
            </div>
          )}
          {recent.map((r, i) => (
            <div key={i} onClick={() => onOpenRecent(r)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px',
                fontSize: '11px', cursor: 'pointer', color: 'var(--text-primary)'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <Database size={11} style={{ color: 'var(--text-muted)' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.server}{r.database ? ` / ${r.database}` : ''}
              </span>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{authShortLabel(r.authType)}</span>
            </div>
          ))}
        </div>

        {connections.length > 0 && (
          <>
            <div style={{
              padding: '7px 12px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.5px', color: 'var(--text-muted)',
              borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', gap: '6px'
            }}>
              <Database size={10} /> saved connections
            </div>
            <div style={{ maxHeight: '200px', overflow: 'auto' }}>
              {connections.map(c => (
                <div key={c.id} onClick={() => onSelectSaved(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px',
                    fontSize: '11px', cursor: 'pointer', color: 'var(--text-primary)'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                  <span style={{
                    width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                    background: c.isConnected ? 'var(--success-color)' : 'var(--text-muted)'
                  }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.label}
                  </span>
                  <span style={{ fontSize: '9px', color: c.isConnected ? 'var(--success-color)' : 'var(--text-muted)' }}>
                    {c.isConnected ? 'connected' : 'disconnected'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div onClick={onNew}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px',
              fontSize: '11px', fontFamily: 'var(--font-mono)', cursor: 'pointer',
              color: 'var(--text-primary)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
            <Plus size={11} style={{ color: 'var(--accent-color)' }} />
            new connection
          </div>
        </div>
      </div>
    </>
  )
}
