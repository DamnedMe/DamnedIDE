import { useState } from 'react'
import { X } from '@/components/icons'
import { useI18n } from '../../i18n'

interface WorktreeCreateDialogProps {
  repoPath: string
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}

export function WorktreeCreateDialog({ repoPath, isOpen, onClose, onCreated }: WorktreeCreateDialogProps) {
  const [branch, setBranch] = useState('')
  const [path, setPath] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useI18n()

  if (!isOpen) return null

  const handleSubmit = async () => {
    if (!branch || !path) return
    setIsLoading(true)
    setError(null)
    try {
      await window.electronAPI.worktree.add(repoPath, branch, path)
      onCreated()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100
    }}>
      <div style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        width: '420px',
        padding: '24px'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <h3 style={{ margin: 0, fontSize: 'calc(15px * var(--ui-text-scale, 1))' }}>{t('new worktree')}</h3>
          <button onClick={onClose} title={t('close')} data-tip-desc={t('close this panel or dialog')} style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer'
          }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ fontSize: 'calc(12px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
            Branch
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder={t('e.g. {example}', { example: 'feature/1234' })}
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 'calc(12px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
            {t('path')}
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={t('e.g. {example}', { example: 'C:\\Source\\Repos\\MyRepo\\.worktrees\\feature\\1234' })}
              style={inputStyle}
            />
          </label>

          {error && (
            <div style={{
              padding: '8px 12px',
              background: 'var(--bg-error)',
              color: 'var(--error-color)',
              borderRadius: '4px',
              fontSize: 'calc(12px * var(--ui-text-scale, 1))'
            }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isLoading || !branch || !path}
            style={{
              marginTop: '8px',
              padding: '8px 16px',
              background: isLoading ? 'var(--bg-disabled)' : 'var(--accent-color)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontSize: 'calc(13px * var(--ui-text-scale, 1))',
              fontWeight: 500
            }}
          >
            {isLoading ? t('creating...') : t('create worktree')}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: '4px',
  padding: '7px 10px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--text-primary)',
  fontSize: 'calc(13px * var(--ui-text-scale, 1))',
  boxSizing: 'border-box'
}
