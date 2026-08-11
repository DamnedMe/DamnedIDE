import { useState } from 'react'
import { useSqlStore } from '../../store'
import { Play } from 'lucide-react'

interface QueryEditorProps {
  connectionId: string | null
  handleRef?: React.MutableRefObject<QueryEditorHandle | null>
}

export interface QueryEditorHandle {
  getQuery: () => string
  setQuery: (text: string) => void
}

export function QueryEditor({ connectionId, handleRef }: QueryEditorProps) {
  const [query, setQuery] = useState('SELECT TOP 100 * FROM ')
  const { setQueryResults, isLoading, setLoading } = useSqlStore()

  if (handleRef) handleRef.current = { getQuery: () => query, setQuery }

  const executeQuery = async () => {
    if (!connectionId || !query.trim()) return
    setLoading(true)
    try {
      setQueryResults(await window.electronAPI.sql.query(connectionId, query))
    } finally { setLoading(false) }
  }

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden', flexShrink: 0
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 10px', borderBottom: '1px solid var(--border-subtle)',
        fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)'
      }}>
        <span>sql query</span>
        <button onClick={executeQuery} disabled={!connectionId || isLoading || !query.trim()}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '3px 10px', fontSize: '10px', fontFamily: 'var(--font-mono)',
            background: connectionId && query.trim() ? 'var(--accent-color)' : 'var(--bg-disabled)',
            color: connectionId && query.trim() ? 'var(--text-inverse)' : 'var(--text-muted)',
            border: 'none', borderRadius: 'var(--radius-sm)',
            cursor: connectionId && query.trim() ? 'pointer' : 'not-allowed'
          }}
        >
          <Play size={10} /> run (F5)
        </button>
      </div>
      <textarea value={query} onChange={(e) => setQuery(e.target.value)}
        disabled={!connectionId}
        placeholder={connectionId ? 'write sql...' : 'connect to a database'}
        spellCheck={false}
        style={{
          width: '100%', minHeight: '80px', padding: '8px 10px',
          background: 'var(--bg-input)', border: 'none',
          color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
          fontSize: '11px', lineHeight: 1.6, resize: 'vertical',
          boxSizing: 'border-box', outline: 'none'
        }}
      />
    </div>
  )
}
