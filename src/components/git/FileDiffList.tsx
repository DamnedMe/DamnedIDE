import { GitFileStatus } from '../../types/git'
import { useState } from 'react'
import { Plus, Minus, Eye, Check, X, Copy } from 'lucide-react'
import { FileTypeIcon } from '../../utils/file-icon'

interface FileDiffListProps {
  files: GitFileStatus[]
  onStage?: (file: string) => void
  onUnstage?: (file: string) => void
  onViewDiff?: (file: string) => void
  activeDiffFile?: string | null
  checkMarks?: Record<string, 'ok' | 'ko'>
  onToggleCheck?: (filePath: string, state: 'ok' | 'ko' | null) => void
  onCopyPath?: (filePath: string) => void
}

export function FileDiffList({ files, onStage, onUnstage, onViewDiff, activeDiffFile, checkMarks, onToggleCheck, onCopyPath }: FileDiffListProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; filePath: string } | null>(null)

  if (files.length === 0) {
    return (
      <div style={{
        padding: '24px', textAlign: 'center',
        color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
        fontFamily: 'var(--font-mono)'
      }}>
        no changes
      </div>
    )
  }

  return (
    <div>
      {files.map((f) => {
        const isActive = activeDiffFile === f.path
        return (
            <div key={`${f.staged ? 's' : 'u'}:${f.path}`} onClick={() => onViewDiff?.(f.path)}
              onContextMenu={onCopyPath ? (e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, filePath: f.path })
              } : undefined}
              style={{
              display: 'flex', alignItems: 'center', padding: '4px 10px',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
              cursor: onViewDiff ? 'pointer' : 'default',
              background: isActive ? 'var(--bg-active)' : 'transparent',
              borderLeft: isActive ? '2px solid var(--accent-color)' : '2px solid transparent',
              transition: 'background 0.1s ease'
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{
              marginRight: '6px', width: '14px', textAlign: 'center',
              color: f.isNew ? 'var(--success-color)' : f.isDeleted ? 'var(--error-color)' : 'var(--warning-color)',
              fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, flexShrink: 0
            }}>
              {f.isNew ? 'A' : f.isDeleted ? 'D' : 'M'}
            </span>
            <span style={{
              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px',
              color: isActive ? 'var(--accent-color)' : 'var(--text-primary)'
            }}>
              <FileTypeIcon path={f.path} size={11} />
              {f.path}
            </span>
            <div style={{ display: 'flex', gap: '3px', flexShrink: 0, marginLeft: '6px' }}>
              {onToggleCheck && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleCheck(f.path, checkMarks?.[f.path] === 'ok' ? null : 'ok') }}
                    title="mark ok" data-tip-desc="mark this file as checked (ok)"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: '18px', height: '18px',
                      background: checkMarks?.[f.path] === 'ok' ? 'var(--success-bg)' : 'var(--bg-subtle)',
                      border: checkMarks?.[f.path] === 'ok' ? '1px solid var(--success-color)' : '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      color: checkMarks?.[f.path] === 'ok' ? 'var(--success-color)' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    <Check size={10} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleCheck(f.path, checkMarks?.[f.path] === 'ko' ? null : 'ko') }}
                    title="mark ko" data-tip-desc="mark this file as not ok (ko)"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: '18px', height: '18px',
                      background: checkMarks?.[f.path] === 'ko' ? 'var(--error-bg)' : 'var(--bg-subtle)',
                      border: checkMarks?.[f.path] === 'ko' ? '1px solid var(--error-color)' : '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      color: checkMarks?.[f.path] === 'ko' ? 'var(--error-color)' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    <X size={10} />
                  </button>
                </>
              )}
              {onViewDiff && (
                <IconBtn onClick={(e) => { e.stopPropagation(); onViewDiff(f.path) }}
                  title="view diff" data-tip-desc="open the diff for this file" bg="var(--bg-tag)" color="var(--accent-color)">
                  <Eye size={9} />
                </IconBtn>
              )}
              {onStage && !f.staged && (
                <IconBtn onClick={(e) => { e.stopPropagation(); onStage(f.path) }}
                  title="stage" data-tip-desc="stage this file" bg="var(--warning-bg)" color="var(--warning-color)">
                  <Plus size={10} />
                </IconBtn>
              )}
              {onUnstage && f.staged && (
                <IconBtn onClick={(e) => { e.stopPropagation(); onUnstage(f.path) }}
                  title="unstage" data-tip-desc="unstage this file" bg="var(--success-bg)" color="var(--success-color)">
                  <Minus size={10} />
                </IconBtn>
              )}
            </div>
          </div>
        )
      })}
      {contextMenu && onCopyPath && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setContextMenu(null)} />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 1000,
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
            padding: '4px 0', minWidth: '150px', animation: 'fadeIn 0.1s ease'
          }}>
            <div
              onClick={() => { onCopyPath(contextMenu.filePath); setContextMenu(null) }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px',
                fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
                cursor: 'pointer', color: 'var(--text-primary)', transition: 'background 0.1s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <Copy size={12} />
              Copy path
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function IconBtn(props: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; title: string; bg: string; color: string; 'data-tip-desc'?: string }) {
  const { children, onClick, title, bg, color, 'data-tip-desc': tipDesc } = props
  return (
    <button onClick={onClick} title={title} data-tip-desc={tipDesc} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '18px', height: '18px', background: bg, border: 'none',
      borderRadius: 'var(--radius-sm)', color, cursor: 'pointer'
    }}>
      {children}
    </button>
  )
}
