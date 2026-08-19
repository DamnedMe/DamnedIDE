import { FileSearch, FileCode, X } from 'lucide-react'

export interface ReferenceHit {
  file: string
  line: number
}

interface ReferencesModalProps {
  symbol: string
  hits: ReferenceHit[]
  title?: string
  rootPath?: string | null
  onClose: () => void
  onNavigate: (file: string, line: number) => void
}

// Compact, readable path: relative to the repo/worktree root when possible,
// otherwise the last folder + 2 levels back (the file name always stays visible).
function displayPath(file: string, rootPath?: string | null): string {
  if (rootPath) {
    const norm = file.replace(/\\/g, '/')
    const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
    if (norm.toLowerCase().startsWith(root.toLowerCase() + '/')) {
      return norm.slice(root.length + 1)
    }
  }
  return file.replace(/\\/g, '/').split('/').filter(Boolean).slice(-3).join('/')
}

export function ReferencesModal({ symbol, hits, title = 'references', rootPath, onClose, onNavigate }: ReferencesModalProps) {
  const base = 'var(--text-primary)'
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 150, backdropFilter: 'blur(2px)'
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', width: '620px', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-mono)', overflow: 'hidden'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
        }}>
          <h3 style={{
            margin: 0, fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden'
          }}>
            <FileSearch size={14} style={{ flexShrink: 0, color: 'var(--accent-color)' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title} — <span style={{ color: 'var(--accent-color)' }}>{symbol}</span>
            </span>
          </h3>
          <button onClick={onClose} title="close" data-tip-desc="close this panel or dialog"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px',
              background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}>
            <X size={12} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '6px' }}>
          {hits.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(11px * var(--ui-text-scale, 1))' }}>
              no references found for <span style={{ color: 'var(--accent-color)' }}>{symbol}</span>
            </div>
          )}
          {hits.map((h, i) => (
            <div key={i}
              onClick={() => onNavigate(h.file, h.line)}
              title={h.file} data-tip-desc="open this file at the reference"
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer', color: base, fontSize: 'calc(11px * var(--ui-text-scale, 1))',
                transition: 'background 0.1s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <FileCode size={12} style={{ flexShrink: 0, color: 'var(--accent-color)' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayPath(h.file, rootPath)}</span>
              <span style={{ flexShrink: 0, color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))' }}>line {h.line}</span>
            </div>
          ))}
        </div>

        <div style={{
          padding: '8px 16px', borderTop: '1px solid var(--border-subtle)',
          fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', flexShrink: 0
        }}>
          {hits.length} {title}
        </div>
      </div>
    </div>
  )
}
