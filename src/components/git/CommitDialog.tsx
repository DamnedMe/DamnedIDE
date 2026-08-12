import { useState } from 'react'
import { X } from 'lucide-react'

interface CommitDialogProps {
  onCommit: (message: string) => void
  onClose: () => void
}

export function CommitDialog({ onCommit, onClose }: CommitDialogProps) {
  const [message, setMessage] = useState('')

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, backdropFilter: 'blur(2px)'
    }}>
      <div style={{
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', width: '440px', padding: '22px',
        fontFamily: 'var(--font-mono)'
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: '16px'
        }}>
          <h3 style={{ margin: 0, fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)' }}>
            commit
          </h3>
          <button onClick={onClose} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '26px', height: '26px', background: 'var(--bg-card)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)', cursor: 'pointer'
          }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}
          >
            <X size={14} />
          </button>
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="commit message..."
          rows={5}
          autoFocus
          style={{
            width: '100%', padding: '10px',
            background: 'var(--bg-input)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
            fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', lineHeight: 1.6,
            resize: 'vertical', boxSizing: 'border-box', outline: 'none'
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-color)' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)' }}
        />

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px'
        }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', background: 'var(--bg-card)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
            color: 'var(--text-secondary)', cursor: 'pointer',
            fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
          }}>
            cancel
          </button>
          <button
            onClick={() => message.trim() && onCommit(message.trim())}
            disabled={!message.trim()}
            style={{
              padding: '7px 16px',
              background: message.trim() ? 'var(--accent-color)' : 'var(--bg-disabled)',
              border: 'none', borderRadius: 'var(--radius-md)',
              color: message.trim() ? 'var(--text-inverse)' : 'var(--text-muted)',
              cursor: message.trim() ? 'pointer' : 'not-allowed',
              fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600, fontFamily: 'var(--font-mono)'
            }}
          >
            commit
          </button>
        </div>
      </div>
    </div>
  )
}
