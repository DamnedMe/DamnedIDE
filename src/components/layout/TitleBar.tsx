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
      position: 'relative',
      display: 'flex', alignItems: 'center',
      height: '32px', background: 'var(--bg-titlebar)',
      borderBottom: '1px solid var(--border-color)',
      userSelect: 'none', ...dragRegion,
      padding: '0 8px'
    }}>
      {onSettings && (
        <button
          onClick={onSettings}
          title="settings" data-tip-desc="open the IDE settings panel"
          data-tip="settings"
          style={{
            ...noDragRegion, display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '22px', height: '22px', border: 'none', borderRadius: 'var(--radius-sm)',
            background: settingsActive ? 'var(--accent-bg)' : 'transparent',
            color: 'var(--accent-color)',
            cursor: 'pointer', transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => { if (!settingsActive) e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { if (!settingsActive) e.currentTarget.style.background = 'transparent' }}
        >
          <Settings size={13} strokeWidth={1.5} />
        </button>
      )}
      <span style={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
        fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600,
        fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', letterSpacing: '0.5px',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: '55%'
      }}>
        {title}
      </span>
      <div style={{ display: 'flex', marginLeft: 'auto', ...noDragRegion }}>
        <WinBtn onClick={() => window.electronAPI.window.minimize()} title="minimize" tipDesc="minimize the window to the taskbar">
          <Minus size={13} strokeWidth={1.5} />
        </WinBtn>
        <WinBtn onClick={() => window.electronAPI.window.maximize()} title="maximize" tipDesc="maximize or restore the window size">
          <Square size={11} strokeWidth={1.5} />
        </WinBtn>
        <WinBtn onClick={() => window.electronAPI.window.close()} isClose title="close" tipDesc="close the window and quit the app">
          <X size={13} strokeWidth={1.5} />
        </WinBtn>
      </div>
    </div>
  )
}

function WinBtn({ children, onClick, isClose, title, tipDesc }: {
  children: React.ReactNode
  onClick: () => void
  isClose?: boolean
  title?: string
  tipDesc?: string
}) {
  return (
    <button onClick={onClick} title={title} data-tip-desc={tipDesc} style={{
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
