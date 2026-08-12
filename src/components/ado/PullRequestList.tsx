import { AdoPullRequest } from '../../types/ado'
import { GitPullRequest, CheckCheck, CircleDot, ThumbsDown } from 'lucide-react'

interface PullRequestListProps {
  pullRequests: AdoPullRequest[]
  onSelect?: (pr: AdoPullRequest) => void
  selectedId?: number | null
}

export function PullRequestList({ pullRequests, onSelect, selectedId }: PullRequestListProps) {
  if (pullRequests.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        padding: '16px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        fontSize: 'calc(12px * var(--ui-text-scale, 1))'
      }}>
        Nessuna pull request attiva
      </div>
    )
  }

  const needsApproval = pullRequests.filter(p => p.needsApproval)
  const others = pullRequests.filter(p => !p.needsApproval)

  const renderItem = (pr: AdoPullRequest) => {
    const active = selectedId === pr.id
    return (
      <div
        key={pr.id}
        onClick={() => onSelect?.(pr)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          gap: '8px',
          cursor: onSelect ? 'pointer' : 'default',
          background: active ? 'var(--accent-bg)' : 'transparent',
          borderLeft: active ? '3px solid var(--accent-color)' : '3px solid transparent',
          transition: 'background 0.1s ease'
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
      >
        <GitPullRequest size={13} style={{ color: pr.isDraft ? 'var(--text-muted)' : 'var(--success-color)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontWeight: 500,
            color: 'var(--text-primary)'
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              #{pr.id}: {pr.title}
            </span>
            {pr.needsApproval && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0,
                padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                background: 'var(--warning-bg)', color: 'var(--warning-color)',
                fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-mono)'
              }}>
                <CheckCheck size={9} /> approval
              </span>
            )}
            {pr.myVote >= 5 && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0,
                padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                background: 'var(--success-bg)', color: 'var(--success-color)',
                fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-mono)'
              }}>
                <CheckCheck size={9} /> approved
              </span>
            )}
            {pr.myVote <= -5 && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0,
                padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                background: 'var(--error-bg)', color: 'var(--error-color)',
                fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-mono)'
              }}>
                <ThumbsDown size={9} /> rejected
              </span>
            )}
            {pr.status === 'completed' && (
              <span style={{
                padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-tag)', color: 'var(--accent-color)',
                fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-mono)', flexShrink: 0
              }}>
                completed
              </span>
            )}
            {pr.isDraft && (
              <span style={{
                padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-subtle)', color: 'var(--text-muted)',
                fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-mono)', flexShrink: 0
              }}>
                draft
              </span>
            )}
          </div>
          <div style={{
            fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)', marginTop: '2px'
          }}>
            {pr.sourceBranch} → {pr.targetBranch}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      overflow: 'hidden', minHeight: 0
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
        fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600,
        color: 'var(--text-secondary)',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0
      }}>
        Pull Requests ({pullRequests.length})
        {needsApproval.length > 0 && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: '3px',
            padding: '1px 6px', borderRadius: 'var(--radius-sm)',
            background: 'var(--warning-bg)', color: 'var(--warning-color)',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, fontFamily: 'var(--font-mono)'
          }}>
            <CircleDot size={9} /> {needsApproval.length} da approvare
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      {needsApproval.length > 0 && (
        <>
          <div style={{
            padding: '4px 12px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700,
            color: 'var(--warning-color)', fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase', letterSpacing: '0.5px',
            background: 'var(--warning-bg)'
          }}>
            richiedono la tua approvazione
          </div>
          {needsApproval.map(renderItem)}
        </>
      )}
      {others.length > 0 && (
        <>
          <div style={{
            padding: '4px 12px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700,
            color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase', letterSpacing: '0.5px'
          }}>
            attive
          </div>
          {others.map(renderItem)}
        </>
      )}
      </div>
    </div>
  )
}
