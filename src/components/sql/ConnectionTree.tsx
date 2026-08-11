import { useState } from 'react'
import { SqlConnection } from '../../types/sql'
import { Database, Plug, Pencil, Trash2 } from 'lucide-react'

interface ConnectionTreeProps {
  connections: SqlConnection[]
  activeConnection: string | null
  onSelect: (id: string | null) => void
  onReconnect: (id: string) => void
  onDisconnect: (id: string) => void
  onEdit: (conn: SqlConnection) => void
  onRemove: (id: string) => void
}

export function ConnectionTree({ connections, activeConnection, onSelect, onReconnect, onDisconnect, onEdit, onRemove }: ConnectionTreeProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; conn: SqlConnection } | null>(null)

  const handleContextMenu = (e: React.MouseEvent, conn: SqlConnection) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, conn })
  }

  const closeMenu = () => setContextMenu(null)

  if (connections.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)', padding: '24px 16px',
        textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px',
        fontFamily: 'var(--font-mono)'
      }}>
        <Plug size={18} strokeWidth={1} style={{ display: 'block', margin: '0 auto 8px' }} />
        no connections
      </div>
    )
  }

  const menuItem = (label: string, icon: React.ReactNode, action: () => void, danger?: boolean) => (
    <div onClick={() => { action(); closeMenu() }}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px',
        fontSize: '11px', fontFamily: 'var(--font-mono)', cursor: 'pointer',
        color: danger ? 'var(--error-color)' : 'var(--text-primary)',
        transition: 'background 0.1s ease'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'var(--error-bg)' : 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
      {icon}
      {label}
    </div>
  )

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden', height: '100%',
      display: 'flex', flexDirection: 'column'
    }}>
      <div style={{
        padding: '7px 12px', fontSize: '10px', fontWeight: 700,
        color: 'var(--text-secondary)', textTransform: 'uppercase',
        letterSpacing: '0.5px', fontFamily: 'var(--font-mono)',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
      }}>
        connections
      </div>
      <div style={{ flex: 1, overflow: 'auto' }} onClick={closeMenu}>
        {connections.map((conn) => (
          <div key={conn.id}
            onClick={() => {
              if (conn.id === activeConnection) { onDisconnect(conn.id); onSelect(null) }
              else { onReconnect(conn.id); onSelect(conn.id) }
            }}
            onContextMenu={(e) => handleContextMenu(e, conn)}
            style={{
              display: 'flex', alignItems: 'center', padding: '8px 12px',
              cursor: 'pointer', gap: '6px',
              background: conn.id === activeConnection ? 'var(--bg-active)' : 'transparent',
              borderBottom: '1px solid var(--border-subtle)',
              borderLeft: conn.id === activeConnection ? '2px solid var(--accent-color)' : '2px solid transparent',
              fontFamily: 'var(--font-mono)'
            }}
          >
            <Database size={12} style={{ color: conn.isConnected ? 'var(--success-color)' : 'var(--text-muted)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '11px', fontWeight: 500, color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {conn.label}
              </div>
              <div style={{
                fontSize: '9px', color: conn.isConnected ? 'var(--success-color)' : 'var(--text-muted)'
              }}>
                {conn.isConnected ? 'connected' : 'disconnected'}
              </div>
            </div>
          </div>
        ))}
      </div>

      {contextMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={closeMenu} />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 200,
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', padding: '4px 0', minWidth: '170px',
            boxShadow: 'var(--shadow-lg)', animation: 'fadeIn 0.1s ease'
          }}>
            {menuItem('connect', <Plug size={12} />, () => onReconnect(contextMenu.conn.id))}
            {menuItem('edit', <Pencil size={12} />, () => onEdit(contextMenu.conn))}
            {menuItem('remove', <Trash2 size={12} />, () => onRemove(contextMenu.conn.id), true)}
          </div>
        </>
      )}
    </div>
  )
}
