import { GitFileStatus } from '../../types/git'
import { Plus, Minus, Eye, Check, X } from 'lucide-react'

interface FileDiffListProps {
  files: GitFileStatus[]
  onStage?: (file: string) => void
  onUnstage?: (file: string) => void
  onViewDiff?: (file: string) => void
  activeDiffFile?: string | null
  checkMarks?: Record<string, 'ok' | 'ko'>
  onToggleCheck?: (filePath: string, state: 'ok' | 'ko' | null) => void
}

export function FileDiffList({ files, onStage, onUnstage, onViewDiff, activeDiffFile, checkMarks, onToggleCheck }: FileDiffListProps) {
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
              whiteSpace: 'nowrap',
              color: isActive ? 'var(--accent-color)' : 'var(--text-primary)'
            }}>
              {f.path}
            </span>
            <div style={{ display: 'flex', gap: '3px', flexShrink: 0, marginLeft: '6px' }}>
              {onToggleCheck && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleCheck(f.path, checkMarks?.[f.path] === 'ok' ? null : 'ok') }}
                    title="mark ok"
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
                    title="mark ko"
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
                  title="view diff" bg="var(--bg-tag)" color="var(--accent-color)">
                  <Eye size={9} />
                </IconBtn>
              )}
              {onStage && !f.staged && (
                <IconBtn onClick={(e) => { e.stopPropagation(); onStage(f.path) }}
                  title="stage" bg="var(--warning-bg)" color="var(--warning-color)">
                  <Plus size={10} />
                </IconBtn>
              )}
              {onUnstage && f.staged && (
                <IconBtn onClick={(e) => { e.stopPropagation(); onUnstage(f.path) }}
                  title="unstage" bg="var(--success-bg)" color="var(--success-color)">
                  <Minus size={10} />
                </IconBtn>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function IconBtn({ children, onClick, title, bg, color }: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  title: string
  bg: string
  color: string
}) {
  return (
    <button onClick={onClick} title={title} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '18px', height: '18px', background: bg, border: 'none',
      borderRadius: 'var(--radius-sm)', color, cursor: 'pointer'
    }}>
      {children}
    </button>
  )
}
