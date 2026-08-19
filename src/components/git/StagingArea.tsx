import { GitFileStatus } from '../../types/git'
import { Plus, Minus } from 'lucide-react'

interface StagingAreaProps {
  modifiedFiles: GitFileStatus[]
  stagedFiles: GitFileStatus[]
  onStage: (file: string) => void
  onUnstage: (file: string) => void
  onCommit: () => void
}

export function StagingArea({ modifiedFiles, stagedFiles, onStage, onUnstage, onCommit }: StagingAreaProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <FileSection
        title={`modified (${modifiedFiles.length})`} data-tip-desc="files modified but not staged"
        files={modifiedFiles}
        actionIcon={<Plus size={12} />}
        onAction={onStage}
        accent="var(--warning-color)"
        accentBg="var(--warning-bg)"
      />
      <FileSection
        title={`staged (${stagedFiles.length})`} data-tip-desc="files staged for the next commit"
        files={stagedFiles}
        actionIcon={<Minus size={12} />}
        onAction={onUnstage}
        accent="var(--success-color)"
        accentBg="var(--success-bg)"
      />
      {stagedFiles.length > 0 && (
        <button onClick={onCommit} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '8px 18px', background: 'var(--accent-color)',
          color: 'var(--text-inverse)', border: 'none',
          borderRadius: 'var(--radius-md)', cursor: 'pointer',
          fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600, fontFamily: 'var(--font-mono)',
          alignSelf: 'flex-start', transition: 'opacity 0.15s ease'
        }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          commit ({stagedFiles.length})
        </button>
      )}
    </div>
  )
}

function FileSection({ title, files, actionIcon, onAction, accent, accentBg }: {
  title: string
  files: GitFileStatus[]
  actionIcon: React.ReactNode
  onAction: (file: string) => void
  accent: string
  accentBg: string
}) {
  if (files.length === 0) return null

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden'
    }}>
      <div style={{
        padding: '6px 12px', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700,
        color: 'var(--text-secondary)', textTransform: 'uppercase',
        letterSpacing: '0.5px', fontFamily: 'var(--font-mono)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: '6px'
      }}>
        <span style={{
          width: '5px', height: '5px', borderRadius: '50%',
          background: accent, display: 'inline-block'
        }} />
        {title}
      </div>
      {files.map((f) => (
        <div key={f.path} style={{
          display: 'flex', alignItems: 'center', padding: '5px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
          transition: 'background 0.1s ease'
        }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <button onClick={() => onAction(f.path)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '20px', height: '20px', marginRight: '8px',
            background: accentBg, border: 'none', borderRadius: 'var(--radius-sm)',
            color: accent, cursor: 'pointer', flexShrink: 0
          }}>
            {actionIcon}
          </button>
          <span style={{
            width: '16px', textAlign: 'center', marginRight: '8px',
            color: f.isNew ? 'var(--success-color)' : f.isDeleted ? 'var(--error-color)' : 'var(--warning-color)',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, flexShrink: 0
          }}>
            {f.isNew ? 'A' : f.isDeleted ? 'D' : 'M'}
          </span>
          <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {f.path}
          </span>
        </div>
      ))}
    </div>
  )
}
