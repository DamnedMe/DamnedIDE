import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FolderOpen, History, Trash2, X } from 'lucide-react'
import { useRecentReposStore } from '../../store'
import { useI18n } from '../../i18n'
import { basenameOf, samePath } from '../../utils/paths'

interface RecentFoldersMenuProps {
  /** top-left corner requested by the caller (usually right of the clicked button) */
  anchor: { x: number; y: number }
  currentPath?: string | null
  onOpen: (path: string) => void
  onBrowse: () => void
  onClose: () => void
}

const MENU_WIDTH = 320

/** Dropdown of the recently opened repositories, plus browse and clear. */
export function RecentFoldersMenu({ anchor, currentPath, onOpen, onBrowse, onClose }: RecentFoldersMenuProps) {
  const repos = useRecentReposStore(s => s.repos)
  const removeRepo = useRecentReposStore(s => s.removeRepo)
  const clearRepos = useRecentReposStore(s => s.clearRepos)
  const t = useI18n()
  const panelRef = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchor.y)

  // Near the bottom of the window (the worktree strip button) the menu opens
  // upward: measured before paint, re-measured when a row is removed.
  useLayoutEffect(() => {
    const h = panelRef.current?.offsetHeight ?? 0
    setTop(Math.max(8, Math.min(anchor.y, window.innerHeight - h - 8)))
  }, [anchor.y, repos.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const choose = (action: () => void) => { onClose(); action() }

  const footerBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 12px',
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={onClose} />
      <div ref={panelRef} role="menu" aria-label="recent repositories" style={{
        position: 'fixed', zIndex: 300, top,
        left: Math.max(8, Math.min(anchor.x, window.innerWidth - MENU_WIDTH - 8)),
        width: `${MENU_WIDTH}px`, background: 'var(--bg-card)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
        fontFamily: 'var(--font-mono)', animation: 'menuIn 140ms ease'
      }}>
        <div style={{
          padding: '7px 12px', fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.5px', color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '6px'
        }}>
          <History size={10} /> {t('recent repositories')}
        </div>

        <div style={{ maxHeight: '260px', overflow: 'auto' }}>
          {repos.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>
              {t('no recent repositories')}
            </div>
          )}
          {repos.map((p) => {
            const isCurrent = !!currentPath && samePath(p, currentPath)
            return (
              <div key={p} role="menuitem" title={p}
                onClick={() => { if (!isCurrent) choose(() => onOpen(p)) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px 6px 12px',
                  cursor: isCurrent ? 'default' : 'pointer'
                }}
                onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                <FolderOpen size={11} style={{ flexShrink: 0, color: isCurrent ? 'var(--accent-color)' : 'var(--text-muted)' }} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{
                    fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600,
                    color: isCurrent ? 'var(--accent-color)' : 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>
                    {basenameOf(p)}
                  </span>
                  <span style={{
                    fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>
                    {p}
                  </span>
                </div>
                {isCurrent && (
                  <span style={{ flexShrink: 0, fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--accent-color)' }}>
                    {t('current')}
                  </span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); removeRepo(p) }}
                  title={t('remove from recents')} data-tip-desc="forget this folder (it stays on disk)"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    padding: '3px', background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-muted)', cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                  <X size={10} />
                </button>
              </div>
            )
          })}
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={() => choose(onBrowse)} style={{ ...footerBtn, color: 'var(--text-primary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}>
            <FolderOpen size={11} style={{ color: 'var(--accent-color)' }} /> {t('browse…')}
          </button>
          {repos.length > 0 && (
            <button onClick={clearRepos} style={{ ...footerBtn, color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
              <Trash2 size={11} /> {t('clear recents')}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
