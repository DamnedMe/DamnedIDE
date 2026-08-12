import { useState } from 'react'
import { Loader2, X, GitBranch, FolderGit2, Bug, Sparkles } from 'lucide-react'
import { useI18n } from '../../i18n'

interface NewWorktreeDialogProps {
  repoPath: string
  onClose: () => void
  onCreated: () => void
}

export function NewWorktreeDialog({ repoPath, onClose, onCreated }: NewWorktreeDialogProps) {
  const [id, setId] = useState('')
  const [wtType, setWtType] = useState<'feature' | 'bugfix'>('feature')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useI18n()

  const branch = id.trim() ? `${wtType}/${id.trim()}` : ''
  const worktreePath = id.trim() ? `${repoPath}\\.worktrees\\${wtType}\\${id.trim()}` : ''

  const handleCreate = async () => {
    if (!branch || !worktreePath || isCreating) return
    setError(null)
    setIsCreating(true)
    try {
      await window.electronAPI.worktree.add(repoPath, branch, worktreePath)
      onCreated()
    } catch (e) {
      setError((e as Error).message || 'Errore durante la creazione del worktree')
    } finally {
      setIsCreating(false)
    }
  }

  const infoRow = (icon: React.ReactNode, label: string, value: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(11px * var(--ui-text-scale, 1))' }}>
      {icon}
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{t(label)}:</span>
      <span style={{ color: 'var(--accent-color)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</span>
    </div>
  )

  const typeBtn = (type: 'feature' | 'bugfix', active: boolean) => (
    <button
      onClick={() => setWtType(type)}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px', flex: 1,
        padding: '7px 10px', background: active ? 'var(--accent-bg)' : 'var(--bg-card)',
        border: active ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
        borderRadius: 'var(--radius-sm)', color: active ? 'var(--accent-color)' : 'var(--text-muted)',
        cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: active ? 600 : 500,
        transition: 'all 0.15s ease'
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--text-muted)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--border-color)' }}
    >
      {type === 'feature' ? <Sparkles size={11} /> : <Bug size={11} />}
      {t(type)}/{'{id}'}
    </button>
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, backdropFilter: 'blur(2px)'
    }}>
      <div style={{
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', width: '460px', padding: '22px',
        fontFamily: 'var(--font-mono)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: 'calc(14px * var(--ui-text-scale, 1))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderGit2 size={15} style={{ color: 'var(--accent-color)' }} />
            {t('new worktree')}
          </h3>
          <button onClick={onClose} title={t('cancel')}
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {typeBtn('feature', wtType === 'feature')}
            {typeBtn('bugfix', wtType === 'bugfix')}
          </div>

          <label style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
            {t('PBI id')}
            <input value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ''))}
              placeholder="es. 3404"
              inputMode="numeric"
              style={{
                display: 'block', width: '100%', marginTop: '4px', padding: '7px 10px',
                background: 'var(--bg-input)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', boxSizing: 'border-box', outline: 'none'
              }}
            />
          </label>

          {infoRow(<GitBranch size={12} />, 'branch', branch)}
          {infoRow(<FolderGit2 size={12} />, 'path', worktreePath)}

          {error && (
            <div style={{ padding: '8px 10px', background: 'var(--error-bg)', color: 'var(--error-color)', borderRadius: 'var(--radius-sm)', fontSize: 'calc(10px * var(--ui-text-scale, 1))' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <button onClick={onClose} style={{
              padding: '7px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer',
              fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
            }}>{t('cancel')}</button>
            <button onClick={handleCreate} disabled={!id.trim() || isCreating}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 16px',
                background: id.trim() && !isCreating ? 'var(--accent-color)' : 'var(--bg-disabled)',
                border: 'none', borderRadius: 'var(--radius-md)',
                color: id.trim() && !isCreating ? 'var(--text-inverse)' : 'var(--text-muted)',
                cursor: id.trim() && !isCreating ? 'pointer' : 'not-allowed',
                fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
              }}>
              {isCreating ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : t('create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
