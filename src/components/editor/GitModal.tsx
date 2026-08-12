import { X, GitCommitHorizontal, Clock } from 'lucide-react'

interface GitModalProps {
  title: string
  text?: string
  blame?: { hash: string; author: string; date: string; line: string }[]
  history?: { hash: string; date: string; message: string; authorName: string }[]
  onClose: () => void
}

export function GitModal({ title, text, blame, history, onClose }: GitModalProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, backdropFilter: 'blur(2px)'
    }}>
      <div style={{
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', width: '720px', maxWidth: '92vw', height: '80vh',
        display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-mono)', overflow: 'hidden'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
        }}>
          <span style={{ fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
          <button onClick={onClose} title="close"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '20px',
              background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}>
            <X size={11} />
          </button>
        </div>

        {text !== undefined && (
          <pre style={{
            flex: 1, overflow: 'auto', margin: 0, padding: '10px 14px',
            fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            lineHeight: 1.5
          }}>{text}</pre>
        )}

        {blame && (
          <div style={{ flex: 1, overflow: 'auto', fontSize: 'calc(10px * var(--ui-text-scale, 1))' }}>
            {blame.map((b, i) => (
              <div key={i} style={{
                display: 'flex', gap: '8px', padding: '2px 14px',
                borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)'
              }}>
                <span style={{ color: 'var(--text-muted)', width: '70px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.hash}>{b.hash.slice(0, 7)}</span>
                <span style={{ color: 'var(--accent-color)', width: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.author}</span>
                <span style={{ color: 'var(--text-muted)', width: '70px', flexShrink: 0 }}>{b.date}</span>
                <span style={{ flex: 1 }}>{b.line}</span>
              </div>
            ))}
          </div>
        )}

        {history && (
          <div style={{ flex: 1, overflow: 'auto', fontSize: 'calc(10px * var(--ui-text-scale, 1))' }}>
            {history.map((c, i) => (
              <div key={i} style={{
                display: 'flex', gap: '8px', padding: '6px 14px',
                borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
                alignItems: 'center'
              }}>
                <GitCommitHorizontal size={10} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
                <span style={{ color: 'var(--text-muted)', width: '70px', flexShrink: 0 }}>{c.hash.slice(0, 7)}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.message}</span>
                <span style={{ color: 'var(--accent-color)', width: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.authorName}</span>
                <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                  <Clock size={9} /> {c.date.slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
