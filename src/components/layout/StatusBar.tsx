import { GitBranch, AlertCircle, CheckCircle2, Sun, Moon } from 'lucide-react'
import logo from '../../assets/logo.png'

interface StatusBarProps {
  repoPath: string | null
  currentBranch?: string
  modifiedCount?: number
  theme?: string
  onToggleTheme?: () => void
}

export function StatusBar({ repoPath, currentBranch, modifiedCount = 0, theme, onToggleTheme }: StatusBarProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: '22px', padding: '0 10px', background: 'var(--bg-statusbar)',
      borderTop: '1px solid var(--border-color)', fontSize: '10px',
      fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
      userSelect: 'none', flexShrink: 0, gap: '12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <img src={logo} alt="logo" style={{ width: '15px', height: '15px', flexShrink: 0, objectFit: 'contain' }} />
        {repoPath ? (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
              <GitBranch size={10} />
              {currentBranch || '—'}
            </span>
            {modifiedCount > 0 ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--warning-color)' }}>
                <AlertCircle size={10} />
                {modifiedCount} modified
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--success-color)' }}>
                <CheckCircle2 size={10} />
                clean
              </span>
            )}
          </>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <AlertCircle size={10} />
            no repository
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {onToggleTheme && (
          <button onClick={onToggleTheme}
            title={`switch to ${theme === 'dark' ? 'light' : 'dark'}`}
            style={{
              display: 'flex', alignItems: 'center', background: 'none',
              border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
              padding: '1px', borderRadius: '2px'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            {theme === 'dark' ? <Sun size={11} /> : <Moon size={11} />}
          </button>
        )}
        <span>{repoPath || 'DamnedIDE'}</span>
      </div>
    </div>
  )
}
