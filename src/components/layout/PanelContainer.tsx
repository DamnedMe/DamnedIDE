import { ReactNode } from 'react'

interface PanelContainerProps {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
}

export function PanelContainer({ title, actions, children, className, headerClassName, contentClassName }: PanelContainerProps) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className={headerClassName} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 0 12px 0', flexShrink: 0
      }}>
        <h2 style={{
          margin: 0, fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 600,
          fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
          letterSpacing: '0.3px'
        }}>
          {title}
        </h2>
        {actions && <div style={{ display: 'flex', gap: '6px' }}>{actions}</div>}
      </div>
      <div className={contentClassName} style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {children}
      </div>
    </div>
  )
}
