import { ReactNode } from 'react'

interface AppShellProps {
  titleBar: ReactNode
  sidebar: ReactNode | null
  statusBar: ReactNode | null
  children: ReactNode
}

export function AppShell({ titleBar, sidebar, statusBar, children }: AppShellProps) {
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
      <div style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden'
      }}>
        {sidebar}
        <main style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          padding: sidebar ? '24px 28px' : '20px 24px',
          background: 'var(--bg-secondary)'
        }}>
          {children}
        </main>
      </div>
      {statusBar}
    </div>
  )
}
