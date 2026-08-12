import { Minus, Square, X, Settings } from 'lucide-react'

interface TitleBarProps {
  title: string
  onSettings?: () => void
  settingsActive?: boolean
}

export function TitleBar({ title, onSettings, settingsActive }: TitleBarProps) {
  const dragRegion = { WebkitAppRegion: 'drag' } as React.CSSProperties
  const noDragRegion = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: '32px', background: 'var(--bg-titlebar)',
      borderBottom: '1px solid var(--border-color)',
      userSelect: 'none', ...dragRegion,
      paddingLeft: '10px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {onSettings && (
          <button
            onClick={onSettings}
            title="settings"
            data-tip="settings"
            data-tip-desc="open the IDE settings panel"
            style={{
              ...noDragRegion, display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', border: 'none', borderRadius: 'var(--radius-sm)',
              background: settingsActive ? 'var(--bg-active)' : 'transparent',
              color: settingsActive ? 'var(--accent-color)' : 'var(--text-muted)',
              cursor: 'pointer', transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (!settingsActive) { e.currentTarget.style.color = 'var(--accent-color)'; e.currentTarget.style.background = 'var(--bg-hover)' }
            }}
            onMouseLeave={(e) => {
              if (!settingsActive) { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }
            }}
          >
            <Settings size={13} strokeWidth={1.5} />
          </button>
        )}
        <span style={{
          fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 600, fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)', letterSpacing: '0.5px'
        }}>
          {title}
        </span>
      </div>
      <div style={{ display: 'flex', ...noDragRegion }}>
        <WinBtn onClick={() => window.electronAPI.window.minimize()} isClose={false}>
          <Minus size={13} strokeWidth={1.5} />
        </WinBtn>
        <WinBtn onClick={() => window.electronAPI.window.maximize()} isClose={false}>
          <Square size={11} strokeWidth={1.5} />
        </WinBtn>
        <WinBtn onClick={() => window.electronAPI.window.close()} isClose>
          <X size={13} strokeWidth={1.5} />
        </WinBtn>
      </div>
    </div>
  )
}

function WinBtn({ children, onClick, isClose }: {
  children: React.ReactNode
  onClick: () => void
  isClose: boolean
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '44px', height: '32px', border: 'none',
      background: 'transparent', color: 'var(--text-muted)',
      cursor: 'pointer', transition: 'background 0.15s ease, color 0.15s ease'
    }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = isClose ? '#e81123' : 'var(--bg-hover)'
        e.currentTarget.style.color = isClose ? '#fff' : 'var(--text-primary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--text-muted)'
      }}
    >
      {children}
    </button>
  )
}
