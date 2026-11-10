import { GitFileStatus } from '../../types/git'
import { useState } from 'react'
import { Plus, Minus, Eye, Check, X, Copy, Undo2, FolderOpen } from '@/components/icons'
import { FileTypeIcon } from '../../utils/file-icon'
import { useSettingsStore } from '../../store'
import { dirOf, fileNameOf, groupChanges } from '../../shared/changeGroups'
import { useI18n } from '../../i18n'

interface FileDiffListProps {
  files: GitFileStatus[]
  onStage?: (file: string) => void
  onUnstage?: (file: string) => void
  /** staged tells apart the two rows of a path both staged and unstaged */
  onViewDiff?: (file: string, staged?: boolean) => void
  activeDiffFile?: string | null
  /** with activeDiffFile: only that path's staged (true) or unstaged (false) row is active */
  activeStaged?: boolean | null
  checkMarks?: Record<string, 'ok' | 'ko'>
  onToggleCheck?: (filePath: string, state: 'ok' | 'ko' | null) => void
  onCopyPath?: (filePath: string) => void
  onDiscard?: (filePath: string, info: { staged: boolean; untracked: boolean }) => void
  onReveal?: (filePath: string) => void
}

export function FileDiffList({ files, onStage, onUnstage, onViewDiff, activeDiffFile, activeStaged, checkMarks, onToggleCheck, onCopyPath, onDiscard, onReveal }: FileDiffListProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; filePath: string; staged: boolean; untracked: boolean } | null>(null)
  const showPath = useSettingsStore(s => s.settings.changesShowPath)
  const t = useI18n()

  if (files.length === 0) {
    return (
      <div style={{
        padding: '24px', textAlign: 'center',
        color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
        fontFamily: 'var(--font-mono)'
      }}>
        {t('no changes')}
      </div>
    )
  }

  // grouped by kind of file; WorktreeChanges walks this same order with the arrow keys
  return (
    <div>
      {groupChanges(files).map(g => (
        <div key={g.id}>
          {/* the line above is the previous row's (or the zone header's) bottom border;
              one line: the label is cut, the count stays */}
          <div title={t(g.label)} style={{
            display: 'flex', whiteSpace: 'nowrap',
            padding: '4px 12px 2px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 600,
            color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px',
            fontFamily: 'var(--font-mono)'
          }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(g.label)}</span>
            <span style={{ flexShrink: 0, whiteSpace: 'pre' }}>{` — ${g.files.length}`}</span>
          </div>
          {g.files.map((f) => {
            const isActive = activeDiffFile === f.path && (activeStaged == null || activeStaged === !!f.staged)
            const dir = showPath ? dirOf(f.path) : ''
            const mark = checkMarks?.[f.path]
            return (
                <div key={`${f.staged ? 's' : 'u'}:${f.path}`} onClick={() => onViewDiff?.(f.path, !!f.staged)}
                  className={isActive ? 'file-diff-row is-active' : 'file-diff-row'}
                  title={f.path} data-tip-delay="1000"
                  onContextMenu={(onCopyPath || onDiscard || onReveal) ? (e) => {
                    e.preventDefault()
                    setContextMenu({
                      x: e.clientX, y: e.clientY, filePath: f.path,
                      staged: !!f.staged,
                      untracked: !!f.isNew
                    })
                  } : undefined}
                  style={{
                  display: 'flex', flexDirection: 'column', padding: '4px 10px',
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <span style={{
                      width: '14px', textAlign: 'center',
                      color: f.isNew ? 'var(--success-color)' : f.isDeleted ? 'var(--error-color)' : 'var(--warning-color)',
                      fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, flexShrink: 0
                    }}>
                      {f.isNew ? 'A' : f.isDeleted ? 'D' : 'M'}
                    </span>
                    <FileTypeIcon path={f.path} size={11} />
                    <span style={{
                      flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      // ok/ko stay readable with the buttons hidden: ok struck through, ko bold red
                      textDecoration: mark === 'ok' ? 'line-through' : undefined,
                      fontWeight: mark === 'ko' ? 700 : undefined,
                      color: mark === 'ko' ? 'var(--error-color)' : mark === 'ok' ? 'var(--text-muted)'
                        : isActive ? 'var(--accent-color)' : 'var(--text-primary)'
                    }}>
                      {fileNameOf(f.path)}
                    </span>
                <div style={{ display: 'flex', gap: '3px', flexShrink: 0, marginLeft: '6px' }}>
                  {onToggleCheck && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleCheck(f.path, checkMarks?.[f.path] === 'ok' ? null : 'ok') }}
                        className="file-diff-hover" title={t('mark ok')} data-tip-desc={t('mark this file as checked (ok)')}
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
                        className="file-diff-hover" title={t('mark ko')} data-tip-desc={t('mark this file as not ok (ko)')}
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
                    <IconBtn onClick={(e) => { e.stopPropagation(); onViewDiff(f.path, !!f.staged) }}
                      title={t('view diff')} data-tip-desc={t('open the diff for this file')} bg="var(--bg-tag)" color="var(--accent-color)">
                      <Eye size={9} />
                    </IconBtn>
                  )}
                  {onStage && !f.staged && (
                    <IconBtn onClick={(e) => { e.stopPropagation(); onStage(f.path) }}
                      className="file-diff-hover" title={t('stage')} data-tip-desc={t('stage this file')} bg="var(--warning-bg)" color="var(--warning-color)">
                      <Plus size={10} />
                    </IconBtn>
                  )}
                  {onUnstage && f.staged && (
                    <IconBtn onClick={(e) => { e.stopPropagation(); onUnstage(f.path) }}
                      className="file-diff-hover" title={t('unstage')} data-tip-desc={t('unstage this file')} bg="var(--success-bg)" color="var(--success-color)">
                      <Minus size={10} />
                    </IconBtn>
                  )}
                </div>
                  </div>
                  {dir && (
                    // under the name (status letter 14px, zoomed icon, two 6px gaps) and under the
                    // buttons too; cut from the START, so the deepest folder stays visible
                    // ("…Infrastructure/Migrations"): rtl only moves the ellipsis, <bdi> keeps the text ltr
                    <span style={{
                      paddingLeft: 'calc(26px + 11px * var(--icon-zoom, 1))',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      direction: 'rtl', textAlign: 'left',
                      fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)'
                    }}>
                      <bdi>{dir}</bdi>
                    </span>
                  )}
              </div>
            )
          })}
        </div>
      ))}
      {contextMenu && (onCopyPath || onDiscard || onReveal) && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setContextMenu(null)} />
          <div style={{
            // clamped: the list can sit at the right edge (side menu on the right)
            position: 'fixed', left: Math.min(contextMenu.x, window.innerWidth - 160), top: contextMenu.y, zIndex: 1000,
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
            padding: '4px 0', minWidth: '150px', animation: 'fadeIn 0.1s ease'
          }}>
            {onCopyPath && (
              <ContextMenuItem
                icon={<Copy size={12} />}
                label={t('Copy path')}
                onClick={() => { onCopyPath(contextMenu.filePath); setContextMenu(null) }}
              />
            )}
            {onReveal && (
              <ContextMenuItem
                icon={<FolderOpen size={12} />}
                label={t('Open in file explorer')}
                onClick={() => { onReveal(contextMenu.filePath); setContextMenu(null) }}
              />
            )}
            {onDiscard && (
              <ContextMenuItem
                icon={<Undo2 size={12} />}
                label={contextMenu.untracked ? t('Discard (delete file)') : t('Discard changes')}
                danger
                onClick={() => {
                  onDiscard(contextMenu.filePath, { staged: contextMenu.staged, untracked: contextMenu.untracked })
                  setContextMenu(null)
                }}
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
        display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px',
        fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
        cursor: 'pointer', color: danger ? 'var(--error-color)' : 'var(--text-primary)',
        transition: 'background 0.1s ease'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'var(--error-bg)' : 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {icon}
      {label}
    </div>
  )
}

function IconBtn(props: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; title: string; bg: string; color: string; 'data-tip-desc'?: string; className?: string }) {
  const { children, onClick, title, bg, color, 'data-tip-desc': tipDesc, className } = props
  return (
    <button onClick={onClick} className={className} title={title} data-tip-desc={tipDesc} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '18px', height: '18px', background: bg, border: 'none',
      borderRadius: 'var(--radius-sm)', color, cursor: 'pointer'
    }}>
      {children}
    </button>
  )
}
