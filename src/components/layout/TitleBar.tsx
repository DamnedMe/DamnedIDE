import { useEffect, useState } from 'react'
import { Minus, Square, X, Settings, FolderOpen, ChevronDown, ExternalLink, type AppIcon } from '@/components/icons'
import { useI18n } from '../../i18n'

export interface TitleBarTab {
  id: string
  /** visible text */
  label: string
  /** shown before the label (decorative: the label names the tab) */
  icon?: AppIcon
  /** tooltip title (kept stable for tests and screen readers) */
  title: string
  tip?: string
}

interface TitleBarProps {
  /** shown centred when there are no tabs (detached windows) */
  title: string
  onSettings?: () => void
  settingsActive?: boolean
  tabs?: TitleBarTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  /** right-click on a tab offers to open that panel in a new window */
  onTabOpenWindow?: (id: string) => void
  /** repository switcher: its label, and where a menu of recent folders may open */
  repoLabel?: string
  onRepoClick?: (anchor: { x: number; y: number }) => void
}

// grows with the IDE text size, like the tab labels it holds
const BAR_HEIGHT = 'calc(13px * var(--ui-text-scale, 1) + 20px)'

export function TitleBar({ title, onSettings, settingsActive, tabs, activeTab, onTabChange, onTabOpenWindow, repoLabel, onRepoClick }: TitleBarProps) {
  const dragRegion = { WebkitAppRegion: 'drag' } as React.CSSProperties
  const noDragRegion = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const t = useI18n()

  useEffect(() => {
    if (!tabMenu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTabMenu(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabMenu])

  return (
    <div style={{
      position: 'relative',
      zIndex: 300, // above modal overlays (200): window controls stay clickable
      display: 'flex', alignItems: 'stretch', gap: '4px',
      height: BAR_HEIGHT, flexShrink: 0, background: 'var(--bg-titlebar)',
      borderBottom: '1px solid var(--border-color)',
      userSelect: 'none', ...dragRegion,
      padding: '0 0 0 8px'
    }}>
      {onSettings && (
        <button
          onClick={onSettings}
          title={t('settings')} data-tip-desc={t('open the IDE settings panel')}
          data-tip={t('settings')}
          style={{
            ...noDragRegion, alignSelf: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 'calc(13px * var(--icon-zoom, 1) + 10px)', height: 'calc(13px * var(--icon-zoom, 1) + 10px)',
            padding: 0, border: 'none', borderRadius: 'var(--radius-sm)', flexShrink: 0,
            background: settingsActive ? 'var(--accent-bg)' : 'transparent',
            color: settingsActive ? 'var(--accent-color)' : 'var(--text-secondary)',
            cursor: 'pointer', transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => { if (!settingsActive) e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { if (!settingsActive) e.currentTarget.style.background = 'transparent' }}
        >
          <Settings size={13} strokeWidth={1.5} />
        </button>
      )}

      {onRepoClick && (
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onRepoClick({ x: r.left, y: r.bottom + 4 })
          }}
          title={repoLabel} data-tip-desc={t('switch to a recent repository or open another folder')}
          style={{
            ...noDragRegion, alignSelf: 'center', display: 'flex', alignItems: 'center', gap: '6px',
            maxWidth: '220px', minWidth: 0, flexShrink: 1, padding: '4px 10px',
            border: 'none', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)',
            color: 'var(--text-primary)', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontWeight: 700
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-input)' }}
        >
          <FolderOpen size={13} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repoLabel}</span>
          <ChevronDown size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        </button>
      )}

      {tabs ? (
        <>
          <div style={{ width: '1px', background: 'var(--border-color)', margin: '8px 6px', flexShrink: 0 }} />
          <nav aria-label={t('panels')} style={{ ...noDragRegion, display: 'flex', alignItems: 'stretch', gap: '2px', minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {tabs.map(tab => {
              const active = tab.id === activeTab
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange?.(tab.id)}
                  onContextMenu={onTabOpenWindow ? (e) => { e.preventDefault(); setTabMenu({ id: tab.id, x: e.clientX, y: e.clientY }) } : undefined}
                  title={tab.title} data-tip-desc={tab.tip}
                  aria-current={active ? 'page' : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '0 14px', flexShrink: 0,
                    border: 'none', borderTop: '2px solid transparent',
                    borderBottom: `2px solid ${active ? 'var(--accent-color)' : 'transparent'}`,
                    background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap',
                    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)', fontSize: 'calc(12px * var(--ui-text-scale, 1))',
                    fontWeight: active ? 700 : 600, transition: 'color .15s ease, border-color .15s ease'
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-muted)' }}
                >
                  {tab.icon && <tab.icon size={13} style={{ flexShrink: 0, color: active ? 'var(--accent-color)' : undefined }} />}
                  {tab.label}
                </button>
              )
            })}
          </nav>
          {tabMenu && onTabOpenWindow && (
            <>
              {/* no-drag: over the title bar a drag region would swallow the click that closes the menu */}
              <div style={{ position: 'fixed', inset: 0, zIndex: 1, ...noDragRegion }} onClick={() => setTabMenu(null)} onContextMenu={(e) => { e.preventDefault(); setTabMenu(null) }} />
              <div role="menu" aria-label={t('panel menu')} style={{
                ...noDragRegion, position: 'fixed', zIndex: 2, top: tabMenu.y + 2,
                left: Math.max(8, Math.min(tabMenu.x, window.innerWidth - 240)),
                minWidth: '200px', padding: '4px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', animation: 'menuIn 140ms ease'
              }}>
                <button role="menuitem" autoFocus
                  onClick={() => { const id = tabMenu.id; setTabMenu(null); onTabOpenWindow(id) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 10px',
                    background: 'none', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 'calc(11.5px * var(--ui-text-scale, 1))', textAlign: 'left'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}>
                  <ExternalLink size={13} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
                  {t('open in a new window')}
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <span style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600,
          fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', letterSpacing: '0.5px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: '55%'
        }}>
          {title}
        </span>
      )}

      <div style={{ display: 'flex', marginLeft: 'auto', flexShrink: 0, ...noDragRegion }}>
        <WinBtn onClick={() => window.electronAPI.window.minimize()} title={t('minimize')} tipDesc={t('minimize the window to the taskbar')}>
          <Minus size={13} strokeWidth={1.5} style={{ zoom: 1 }} />
        </WinBtn>
        <WinBtn onClick={() => window.electronAPI.window.maximize()} title={t('maximize')} tipDesc={t('maximize or restore the window size')}>
          <Square size={11} strokeWidth={1.5} style={{ zoom: 1 }} />
        </WinBtn>
        <WinBtn onClick={() => window.electronAPI.window.close()} isClose title={t('close')} tipDesc={t('close the window and quit the app')}>
          <X size={13} strokeWidth={1.5} style={{ zoom: 1 }} />
        </WinBtn>
      </div>
    </div>
  )
}

// window controls keep the native size whatever the icon-size setting (zoom: 1 above)
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
      width: '46px', height: '100%', border: 'none',
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
