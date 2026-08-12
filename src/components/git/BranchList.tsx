import { BranchInfo } from '../../types/git'
import { GitBranch, GitBranchPlus } from 'lucide-react'

interface BranchListProps {
  branches: BranchInfo[]
  currentBranch: string
  repoPath: string
  onBranchChanged: () => void
}

export function BranchList({ branches, currentBranch }: BranchListProps) {
  const localBranches = branches.filter(b => !b.remote)
  const remoteBranches = branches.filter(b => b.remote)

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', height: '100%'
    }}>
      <div style={{
        padding: '7px 12px', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700,
        color: 'var(--text-secondary)', textTransform: 'uppercase',
        letterSpacing: '0.5px', fontFamily: 'var(--font-mono)',
        borderBottom: '1px solid var(--border-subtle)'
      }}>
        branches ({localBranches.length})
      </div>
      <div style={{ flex: 1, overflow: 'auto', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
        {localBranches.map((b) => (
          <div key={b.name} style={{
            display: 'flex', alignItems: 'center', padding: '5px 12px',
            color: b.current ? 'var(--accent-color)' : 'var(--text-primary)',
            background: b.current ? 'var(--bg-active)' : 'transparent',
            fontWeight: b.current ? 600 : 400, gap: '6px', cursor: 'default',
            borderLeft: b.current ? '2px solid var(--accent-color)' : '2px solid transparent',
            transition: 'background 0.1s ease'
          }}>
            <GitBranch size={11} style={{ color: b.current ? 'var(--accent-color)' : 'var(--text-muted)' }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.name}
            </span>
            {b.current && (
              <span style={{ fontSize: 'calc(7px * var(--ui-text-scale, 1))', color: 'var(--accent-color)', lineHeight: 1 }}>●</span>
            )}
          </div>
        ))}

        {remoteBranches.length > 0 && (
          <>
            <div style={{
              padding: '8px 12px 4px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700,
              color: 'var(--text-muted)', textTransform: 'uppercase',
              letterSpacing: '0.5px', fontFamily: 'var(--font-mono)',
              borderTop: '1px solid var(--border-subtle)'
            }}>
              remote ({remoteBranches.length})
            </div>
            {remoteBranches.map((b) => (
              <div key={b.name} style={{
                display: 'flex', alignItems: 'center', padding: '4px 12px',
                color: 'var(--text-muted)', gap: '6px'
              }}>
                <GitBranchPlus size={11} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
