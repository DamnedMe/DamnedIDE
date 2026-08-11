import { ReactNode } from 'react'

interface PanelContainerProps {
  title: string
  actions?: ReactNode
  children: ReactNode
}

export function PanelContainer({ title, actions, children }: PanelContainerProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 0 12px 0', flexShrink: 0
      }}>
        <h2 style={{
          margin: 0, fontSize: '13px', fontWeight: 600,
          fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
          letterSpacing: '0.3px'
        }}>
          {title}
        </h2>
        {actions && <div style={{ display: 'flex', gap: '6px' }}>{actions}</div>}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {children}
      </div>
    </div>
  )
}
