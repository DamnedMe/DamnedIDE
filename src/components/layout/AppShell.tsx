import { ReactNode } from 'react'

interface AppShellProps {
  titleBar: ReactNode
  statusBar: ReactNode | null
  /** padding around the active panel; '0' for a panel drawn edge to edge */
  contentPadding?: string
  children: ReactNode
}

export function AppShell({ titleBar, statusBar, contentPadding = '8px 10px', children }: AppShellProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      overflow: 'hidden',
      fontFamily: 'var(--font-mono)'
    }}>
      {titleBar}
      <main style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        padding: contentPadding,
        background: 'var(--bg-secondary)'
      }}>
        {children}
      </main>
      {statusBar}
    </div>
  )
}
