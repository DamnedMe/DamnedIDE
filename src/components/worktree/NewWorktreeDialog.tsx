import { useState } from 'react'
import { Loader2, X, GitBranch, FolderGit2, Bug, Sparkles, Layers } from '@/components/icons'
import { useI18n, tr } from '../../i18n'
import { joinPath } from '../../utils/paths'
import { useSettingsStore } from '../../store'
import { DEFAULT_WORKTREE_LAYOUT, isAbsolutePath } from './worktree-cleanup'
import type { WorktreeEntry } from '../../types/worktree'

interface NewWorktreeDialogProps {
  repoPath: string
  /** where a relative worktree root is resolved: the main checkout (default: repoPath), so a
   *  linked worktree opened as the repository does not get the new worktrees nested inside it */
  basePath?: string
  /** other worktrees: their branches can be used as the base (stacked worktree) */
  worktrees?: WorktreeEntry[]
  onClose: () => void
  onCreated: () => void
}

export function NewWorktreeDialog({ repoPath, basePath = repoPath, worktrees, onClose, onCreated }: NewWorktreeDialogProps) {
  const [id, setId] = useState('')
  const [wtType, setWtType] = useState<'feature' | 'bugfix'>('feature')
  const [base, setBase] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useI18n()

  // Settings › Git › worktree: root (relative to the main checkout unless absolute) and the type subfolder
  const layout = useSettingsStore(s => s.settings.worktreeLayout) ?? DEFAULT_WORKTREE_LAYOUT
  const rootDir = isAbsolutePath(layout.root) ? layout.root : joinPath(basePath, layout.root.trim().replace(/^\.(?:[\\/]|$)/, ''))
  const branch = id.trim() ? `${wtType}/${id.trim()}` : ''
  const worktreePath = id.trim() ? joinPath(rootDir, wtType === 'feature' ? layout.pbiFolder : layout.bugFolder, id.trim()) : ''

  // candidate bases: every other worktree's branch (excluding the one being created)
  const baseOptions = (worktrees || [])
    .map(e => e.branch.replace(/^refs\/heads\//, ''))
    .filter(b => b && b !== branch && !b.startsWith('('))
    .sort()

  const handleCreate = async () => {
    if (!branch || !worktreePath || isCreating) return
    setError(null)
    setIsCreating(true)
    try {
      await window.electronAPI.worktree.add(repoPath, branch, worktreePath, base || undefined)
      onCreated()
    } catch (e) {
      setError((e as Error).message || tr('error while creating the worktree'))
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
          <button onClick={onClose} title={t('cancel')} data-tip-desc={t('close the dialog')}
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
              placeholder={t('e.g. {example}', { example: '3404' })}
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

          <label style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
            base
            <select value={base} onChange={(e) => setBase(e.target.value)}
              title={t('branch the new worktree starts from')} data-tip-desc={t('start point of the new branch: develop or another branch (stacked worktree)')}
              style={{
                display: 'block', width: '100%', marginTop: '4px', padding: '7px 10px',
                background: 'var(--bg-input)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', boxSizing: 'border-box', outline: 'none'
              }}>
              <option value="">develop ({t('default')})</option>
              {baseOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>

          {base && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '7px 10px',
              background: 'var(--accent-bg)', border: '1px solid var(--accent-color)',
              borderRadius: 'var(--radius-sm)', color: 'var(--accent-color)',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', lineHeight: 1.6
            }}>
              <Layers size={12} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {t('stacked worktree:')} <b>{branch || t('new branch')}</b> {t('will start from')} <b>{base}</b>,{' '}
                {t('not from develop. Completing it will open the PR towards {base}.', { base })}
              </span>
            </div>
          )}

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
