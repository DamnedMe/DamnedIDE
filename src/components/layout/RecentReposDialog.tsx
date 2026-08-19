import { FolderOpen, History, Trash2, X } from 'lucide-react'

interface RecentReposDialogProps {
  repos: string[]
  onOpenRepo: (path: string) => void
  onOpenFolder: () => void
  onSkip: () => void
  onClear: () => void
}

export function RecentReposDialog({ repos, onOpenRepo, onOpenFolder, onSkip, onClear }: RecentReposDialogProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, backdropFilter: 'blur(2px)'
    }}>
      <div style={{
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', width: '460px', padding: '22px',
        fontFamily: 'var(--font-mono)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, fontSize: 'calc(14px * var(--ui-text-scale, 1))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={15} style={{ color: 'var(--accent-color)' }} />
            open repository
          </h3>
          <button onClick={onSkip} title="skip" data-tip-desc="skip this step"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px',
              background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}>
            <X size={12} />
          </button>
        </div>

        <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', marginBottom: '10px' }}>
          recent repositories
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '260px', overflow: 'auto', marginBottom: '14px' }}>
          {repos.length === 0 && (
            <div style={{ padding: '18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(11px * var(--ui-text-scale, 1))' }}>
              no recent repositories
            </div>
          )}
          {repos.map((r) => (
            <div key={r}
              onClick={() => onOpenRepo(r)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'border-color 0.1s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-color)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)' }}>
              <FolderOpen size={13} style={{ flexShrink: 0, color: 'var(--accent-color)' }} />
              <span style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <button onClick={onClear} title="clear recent repos" data-tip-desc="remove all recently opened repositories"
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px',
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}>
            <Trash2 size={11} /> clear
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onSkip} style={{
              padding: '7px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer',
              fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
            }}>skip</button>
            <button onClick={onOpenFolder} style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 16px',
              background: 'var(--accent-color)', color: 'var(--text-inverse)',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
            }}>
              <FolderOpen size={12} /> open folder
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
