import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { PanelLeftClose, PanelLeftOpen, FolderOpen } from 'lucide-react'

export interface SidebarTab {
  id: string
  icon: LucideIcon
  label: string
}

interface SidebarProps {
  tabs: SidebarTab[]
  activeTab: string
  onTabChange: (tabId: string) => void
  onOpenFolder?: () => void
}

export function Sidebar({ tabs, activeTab, onTabChange, onOpenFolder }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    return (
      <nav style={{
        width: '28px', flexShrink: 0,
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center', paddingTop: '12px'
      }}>
        <button
          onClick={() => setCollapsed(false)}
          title="expand sidebar"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '20px', height: '20px', background: 'none', border: 'none',
            color: 'var(--text-muted)', cursor: 'pointer'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          <PanelLeftOpen size={13} />
        </button>
      </nav>
    )
  }

  return (
    <nav style={{
      display: 'flex',
      flexDirection: 'column',
      width: '48px',
      background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border-color)',
      paddingTop: '8px',
      gap: '2px',
      flexShrink: 0,
      alignItems: 'center'
    }}>
      <button
        onClick={() => setCollapsed(true)}
        title="collapse sidebar"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '36px', height: '24px', marginBottom: '6px',
          background: 'none', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', borderRadius: 'var(--radius-sm)'
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
      >
        <PanelLeftClose size={13} />
      </button>

      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        const Icon = tab.icon
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            title={tab.label}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '36px', height: '36px', border: 'none',
              borderRadius: 'var(--radius-md)',
              background: isActive ? 'var(--bg-active)' : 'transparent',
              color: isActive ? 'var(--accent-color)' : 'var(--text-muted)',
              cursor: 'pointer', transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--text-secondary)'
                e.currentTarget.style.background = 'var(--bg-hover)'
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--text-muted)'
                e.currentTarget.style.background = 'transparent'
              }
            }}
          >
            <Icon size={19} strokeWidth={isActive ? 2 : 1.5} />
          </button>
        )
      })}

      {onOpenFolder && (
        <>
          <div style={{ width: '28px', height: '1px', background: 'var(--border-subtle)', margin: '6px 0' }} />
          <button
            onClick={onOpenFolder}
            title="change main folder"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '36px', height: '36px', border: 'none',
              borderRadius: 'var(--radius-md)',
              background: 'transparent', color: 'var(--text-muted)',
              cursor: 'pointer', transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--accent-color)'
              e.currentTarget.style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <FolderOpen size={19} strokeWidth={1.5} />
          </button>
        </>
      )}
    </nav>
  )
}
