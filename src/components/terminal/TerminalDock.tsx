import { Terminal, ChevronDown } from 'lucide-react'
import { TerminalPanel } from './TerminalPanel'
import { AiChatPanel } from './AiChatPanel'
import { useTerminalStore } from '../../store'

// Bottom dock: rendered INSIDE a panel's content, below its own internal sections
// (changes inspector, file viewer, ...). It shows EITHER the terminal or the AI chat
// (alternative modes) based on the shared dock store, toggled from the status bar.
export function TerminalDock({ repoPath }: { repoPath?: string | null }) {
  const open = useTerminalStore(s => s.open)
  const height = useTerminalStore(s => s.height)
  const mode = useTerminalStore(s => s.mode)
  const setOpen = useTerminalStore(s => s.setOpen)
  const setHeight = useTerminalStore(s => s.setHeight)

  if (!open) return null

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMove = (ev: MouseEvent) => {
      const inner = window.innerHeight - 54
      const h = Math.max(80, Math.min(inner - 32, window.innerHeight - ev.clientY - 50))
      setHeight(h)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const isAi = mode === 'ai'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)',
      marginTop: '6px'
    }}>
      <div onMouseDown={startResize} title="resize" data-tip-desc="drag to resize the panel"
        style={{ height: '4px', cursor: 'row-resize', flexShrink: 0 }} />
      {!isAi && (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1px 8px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
      }}>
        <span style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700,
          color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px'
        }}>
          <Terminal size={10} style={{ color: 'var(--accent-color)' }} />
          terminal
        </span>
        <button onClick={() => setOpen(false)} title="minimize" data-tip-desc="minimize the panel back to the status bar icon"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '20px', height: '18px', background: 'none', border: 'none',
            color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 'var(--radius-sm)'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
          <ChevronDown size={12} />
        </button>
      </div>
      )}
      <div style={{ height, minHeight: 80, flexShrink: 0 }}>
        {isAi ? <AiChatPanel /> : <TerminalPanel repoPath={repoPath} />}
      </div>
    </div>
  )
}
