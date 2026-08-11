import { useState } from 'react'
import { useWorktreeStore } from '../../store'
import { WorktreeEntry } from '../../types/worktree'
import { GitBranch, Loader2, Trash2, EyeOff, Eye, GitPullRequest } from 'lucide-react'

interface WorktreeListProps {
  repoPath: string
  entries: WorktreeEntry[]
  isLoading: boolean
  onRemove?: (path: string) => void
  onComplete?: (entry: WorktreeEntry) => void
}

export function WorktreeList({ repoPath, entries, isLoading, onRemove, onComplete }: WorktreeListProps) {
  const { selectedWorktree, selectWorktree } = useWorktreeStore()
  const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: WorktreeEntry } | null>(null)

  const filteredEntries = showHidden
    ? entries
    : entries.filter(e => !hiddenPaths.has(e.path))

  const handleContextMenu = (e: React.MouseEvent, entry: WorktreeEntry) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }

  const closeContextMenu = () => setContextMenu(null)

  const handleHide = (path: string) => {
    setHiddenPaths(prev => new Set([...prev, path]))
    closeContextMenu()
  }

  const handleUnhide = (path: string) => {
    setHiddenPaths(prev => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
    closeContextMenu()
  }

  const handleUnhideAll = () => {
    setHiddenPaths(new Set())
    closeContextMenu()
  }

  const handleRemove = async (path: string) => {
    closeContextMenu()
    onRemove?.(path)
  }

  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '48px', color: 'var(--text-muted)'
      }}>
        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      onClick={closeContextMenu}>
      {/* Filter bar */}
      {hiddenPaths.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '4px 10px', background: 'var(--bg-subtle)',
          borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
        }}>
          <button onClick={() => setShowHidden(!showHidden)}
            title={showHidden ? 'hide hidden' : 'show hidden'}
            style={{
              display: 'flex', alignItems: 'center', gap: '3px',
              padding: '2px 8px', background: showHidden ? 'var(--bg-active)' : 'var(--bg-card)',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
              color: showHidden ? 'var(--accent-color)' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: '9px', fontFamily: 'var(--font-mono)'
            }}>
            {showHidden ? <Eye size={10} /> : <EyeOff size={10} />}
            {hiddenPaths.size} hidden
          </button>
          {showHidden && (
            <button onClick={handleUnhideAll}
              style={{
                display: 'flex', alignItems: 'center', gap: '3px',
                padding: '2px 6px', background: 'var(--bg-card)',
                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)', cursor: 'pointer', fontSize: '9px',
                fontFamily: 'var(--font-mono)'
              }}>
              unhide all
            </button>
          )}
        </div>
      )}

      {/* Entries */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px' }}>
        {filteredEntries.length === 0 && entries.length > 0 && (
          <div style={{
            padding: '24px 12px', textAlign: 'center',
            color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'var(--font-mono)'
          }}>
            all worktrees hidden
          </div>
        )}
        {filteredEntries.map((entry) => {
          const isSelected = selectedWorktree === entry.path
          const isMain = !entry.path.includes('.worktrees')
          const isHidden = hiddenPaths.has(entry.path)
          return (
            <div
              key={entry.path}
              onClick={() => selectWorktree(isSelected ? null : entry.path)}
              onContextMenu={(e) => handleContextMenu(e, entry)}
              style={{
                padding: '12px 14px', marginBottom: '4px',
                background: isSelected ? 'var(--bg-active)' : 'var(--bg-card)',
                border: `1px solid ${isSelected ? 'var(--accent-color)' : 'var(--border-color)'}`,
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
                transition: 'border-color 0.15s ease, background 0.15s ease',
                opacity: isHidden && !showHidden ? 0.4 : 1
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.borderColor = 'var(--text-muted)'
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.borderColor = 'var(--border-color)'
              }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '5px'
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  fontWeight: 600, fontSize: '12.5px', fontFamily: 'var(--font-mono)',
                  color: isSelected ? 'var(--accent-color)' : 'var(--text-primary)'
                }}>
                  <GitBranch size={13} style={{ color: isSelected ? 'var(--accent-color)' : 'var(--text-muted)' }} />
                  {entry.branch || entry.head.substring(0, 7)}
                </div>
                <div style={{ display: 'flex', gap: '3px' }}>
                  {isMain && (
                    <span style={{
                      fontSize: '9px', fontWeight: 600, padding: '2px 6px',
                      background: 'var(--bg-tag)', color: 'var(--accent-color)',
                      borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)'
                    }}>
                      main
                    </span>
                  )}
                  {entry.detached && (
                    <span style={{
                      fontSize: '9px', fontWeight: 600, padding: '2px 6px',
                      background: 'var(--warning-bg)', color: 'var(--warning-color)',
                      borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)'
                    }}>
                      detached
                    </span>
                  )}
                  {isHidden && showHidden && (
                    <span style={{
                      fontSize: '9px', fontWeight: 600, padding: '2px 6px',
                      background: 'var(--bg-subtle)', color: 'var(--text-muted)',
                      borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)'
                    }}>
                      hidden
                    </span>
                  )}
                </div>
              </div>
              <div style={{
                fontSize: '10px', color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)', wordBreak: 'break-all'
              }}>
                {entry.path}
              </div>
            </div>
          )
        })}

        {entries.length === 0 && !isLoading && (
          <div style={{
            padding: '40px 16px', textAlign: 'center',
            color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-mono)'
          }}>
            no worktrees
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div style={{
            position: 'fixed', inset: 0, zIndex: 199
          }} onClick={closeContextMenu} />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 200,
            background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', padding: '4px', minWidth: '160px',
            boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--font-mono)', fontSize: '11px',
            animation: 'fadeIn 0.1s ease'
          }}>
            {hiddenPaths.has(contextMenu.entry.path) ? (
              <ContextMenuItem
                icon={<Eye size={12} />}
                label="unhide"
                onClick={() => handleUnhide(contextMenu.entry.path)}
              />
            ) : (
              <ContextMenuItem
                icon={<EyeOff size={12} />}
                label="hide from list"
                onClick={() => handleHide(contextMenu.entry.path)}
              />
            )}
            <ContextMenuItem
              icon={<GitPullRequest size={12} />}
              label="completa worktree"
              onClick={() => { onComplete?.(contextMenu.entry); closeContextMenu() }}
            />
            {!contextMenu.entry.path.includes('.worktrees') ? null : (
              <ContextMenuItem
                icon={<Trash2 size={12} />}
                label="remove worktree"
                onClick={() => handleRemove(contextMenu.entry.path)}
                danger
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ContextMenuItem({ icon, label, onClick, danger }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '6px 10px', borderRadius: 'var(--radius-sm)',
        cursor: 'pointer', color: danger ? 'var(--error-color)' : 'var(--text-secondary)',
        transition: 'background 0.1s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'var(--error-bg)' : 'var(--bg-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {icon}
      {label}
    </div>
  )
}
