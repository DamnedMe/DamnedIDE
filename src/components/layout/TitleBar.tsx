import { Minus, Square, X } from 'lucide-react'

interface TitleBarProps {
  title: string
}

export function TitleBar({ title }: TitleBarProps) {
  const dragRegion = { WebkitAppRegion: 'drag' } as React.CSSProperties
  const noDragRegion = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: '32px', background: 'var(--bg-titlebar)',
      borderBottom: '1px solid var(--border-color)',
      userSelect: 'none', ...dragRegion,
      paddingLeft: '14px'
    }}>
      <span style={{
        fontSize: '10px', fontWeight: 600, fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)', letterSpacing: '0.5px'
      }}>
        {title}
      </span>
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
