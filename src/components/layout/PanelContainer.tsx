import { ReactNode } from 'react'

interface PanelContainerProps {
  title?: ReactNode
  actions?: ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
  children: ReactNode
}

// The simple per-panel title row was removed (the panel name now lives centered in
// the window title bar): panels that used to pass a plain title no longer do. Rich
// headers (e.g. SQL workbench with connection status) and the actions strip are kept.
export function PanelContainer({ title, actions, className, headerClassName, contentClassName, children }: PanelContainerProps) {
  const hasHeader = !!title || !!actions
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {hasHeader && (
        <div className={headerClassName} style={{
          display: 'flex', alignItems: 'center',
          justifyContent: title ? 'space-between' : 'flex-end',
          padding: '0 0 8px 0', flexShrink: 0, gap: '8px'
        }}>
          {title && <div style={{ flex: 1, minWidth: 0 }}>{title}</div>}
          {actions && <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>{actions}</div>}
        </div>
      )}
      <div className={contentClassName} style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {children}
      </div>
    </div>
  )
}
