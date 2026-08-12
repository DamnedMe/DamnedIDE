import { useState, useEffect, useMemo, useRef } from 'react'
import { AppShell } from './components/layout/AppShell'
import { TitleBar } from './components/layout/TitleBar'
import { Sidebar, SidebarTab } from './components/layout/Sidebar'
import { StatusBar } from './components/layout/StatusBar'
import { WorktreePanel } from './components/worktree/WorktreePanel'
import { GitPanel } from './components/git/GitPanel'
import { AdoPanel } from './components/ado/AdoPanel'
import { SqlPanel } from './components/sql/SqlPanel'
import { CodeEditor } from './components/editor/CodeEditor'
import { TerminalPanel } from './components/terminal/TerminalPanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { ToastHost } from './components/layout/ToastHost'
import { TooltipHost } from './components/layout/TooltipHost'
import { RecentReposDialog } from './components/layout/RecentReposDialog'
import { useUIStore, useGitStore, useSettingsStore, useAdoStore, useRecentReposStore, useSqlStore } from './store'
import { useI18n } from './i18n'
import { hexToRgba } from './utils/color'
import { defineThemes, THEME_DARK, THEME_LIGHT } from './components/editor/monaco-theme'
import {
  GitBranch,
  Network,
  Database,
  Code2,
  Boxes,
  Terminal
} from 'lucide-react'
import './styles/themes/dark.css'
import './styles/themes/light.css'

type PanelId = 'worktree' | 'git' | 'ado' | 'sql' | 'editor' | 'terminal' | 'settings'

export default function App() {
  const [activePanel, setActivePanel] = useState<PanelId>('worktree')
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [showRecent, setShowRecent] = useState(false)
  const { theme, setTheme } = useUIStore()
  const settingsTheme = useSettingsStore(s => s.settings.theme)
  const accentColor = useSettingsStore(s => s.settings.accentColor)
  const iconSize = useSettingsStore(s => s.settings.iconSize)
  const fontSize = useSettingsStore(s => s.settings.fontSize)
  const updateSettings = useSettingsStore(s => s.updateSettings)
  const gitStatus = useGitStore(s => s.status)
  const gitFiles = useGitStore(s => s.files)
  const modifiedCount = gitFiles.filter(f => !f.staged).length
  const themesDefined = useRef(false)
  const recentRepos = useRecentReposStore(s => s.repos)
  const addRepo = useRecentReposStore(s => s.addRepo)
  const clearRepos = useRecentReposStore(s => s.clearRepos)
  const [updateReady, setUpdateReady] = useState(false)

  const detachedPanel = useMemo<PanelId | null>(() => {
    const match = window.location.hash.match(/^#\/panel\/(\w+)/)
    return match ? (match[1] as PanelId) : null
  }, [])

  useEffect(() => {
    const t = settingsTheme
    document.documentElement.setAttribute('data-theme', t)
    if (t !== theme) setTheme(t)
  }, [settingsTheme])

  // User-defined primary color: overrides the theme accent (both dark and light) and
  // its translucent derivates, independent of the active theme.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent-color', accentColor)
    root.style.setProperty('--border-focus', accentColor)
    root.style.setProperty('--accent-bg', hexToRgba(accentColor, 0.13))
    root.style.setProperty('--bg-active', hexToRgba(accentColor, 0.06))
    root.style.setProperty('--bg-hover', hexToRgba(accentColor, 0.04))
    root.style.setProperty('--bg-tag', hexToRgba(accentColor, 0.08))
    root.style.setProperty('--accent-glow', hexToRgba(accentColor, 0.1))
  }, [accentColor])

  // Initialize the ADO service in the main process from a persisted connection,
  // so ADO features work from any panel without visiting Azure DevOps first.
  useEffect(() => {
    const conn = useAdoStore.getState().connection
    if (conn?.isConnected && conn.organization && conn.token) {
      window.electronAPI.ado.connect(conn.organization, conn.token).catch(() => {})
    }
  }, [])

  // Propose opening a recent repo at startup (up to the last 5 opened).
  useEffect(() => {
    if (useRecentReposStore.getState().repos.length > 0) setShowRecent(true)
  }, [])

  // Reconnect persisted SQL connections on startup so they are available instantly.
  useEffect(() => {
    const conns = useSqlStore.getState().connections
    if (conns.length === 0) return
    let cancelled = false
    ;(async () => {
      for (const c of conns) {
        if (cancelled || c.isConnected) continue
        try {
          await window.electronAPI.sql.connect({ ...c, connectionId: c.id })
          if (cancelled) break
          useSqlStore.getState().updateConnection(c.id, { isConnected: true })
        } catch { /* server offline */ }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Listen for a downloaded update: offer to restart and install.
  useEffect(() => {
    const unsub = window.electronAPI.updater.onDownloaded(() => setUpdateReady(true))
    return unsub
  }, [])

  const handleRepoSelected = (path: string) => {
    addRepo(path)
    setRepoPath(path)
  }

  const handleOpenFolder = async () => {
    const p = await window.electronAPI.dialog.openFolder()
    if (p) handleRepoSelected(p)
  }

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  // Global icon scale (lucide) and base font for the whole UI, from settings.
  useEffect(() => {
    document.documentElement.style.setProperty('--icon-zoom', String(iconSize / 14))
  }, [iconSize])

  useEffect(() => {
    document.body.style.fontSize = `${fontSize}px`
  }, [fontSize])

  const t = useI18n()
  const tabs: SidebarTab[] = [
    { id: 'worktree', icon: Boxes, label: t('worktree') },
    { id: 'editor', icon: Code2, label: t('editor') },
    { id: 'git', icon: GitBranch, label: t('git') },
    { id: 'ado', icon: Network, label: t('ado') },
    { id: 'sql', icon: Database, label: t('sql') },
    { id: 'terminal', icon: Terminal, label: t('terminal') }
  ]

  const lastPanelRef = useRef<PanelId>('worktree')
  const handleSettingsToggle = () => {
    setActivePanel(prev => {
      if (prev === 'settings') return lastPanelRef.current
      lastPanelRef.current = prev
      return 'settings'
    })
  }

  const renderPanel = (panel: PanelId) => {
    switch (panel) {
      case 'worktree':
        return <WorktreePanel repoPath={repoPath} onRepoSelected={handleRepoSelected} />
      case 'git':
        return <GitPanel repoPath={repoPath} />
      case 'ado':
        return <AdoPanel />
      case 'sql':
        return <SqlPanel />
      case 'editor':
        return <CodeEditor />
      case 'terminal':
        return <TerminalPanel repoPath={repoPath} />
      case 'settings':
        return <SettingsPanel />
    }
  }

  if (detachedPanel) {
    return (
      <AppShell
        titleBar={<TitleBar title={`DamnedIDE — ${detachedPanel}`} onSettings={handleSettingsToggle} settingsActive={detachedPanel === 'settings'} />}
        sidebar={null}
        statusBar={null}
      >
        {renderPanel(detachedPanel)}
        <ToastHost />
        <TooltipHost />
      </AppShell>
    )
  }

  return (
    <AppShell
      titleBar={<TitleBar title={`DamnedIDE${repoPath ? ` — ${repoPath}` : ''}`} onSettings={handleSettingsToggle} settingsActive={activePanel === 'settings'} />}
      sidebar={<Sidebar tabs={tabs} activeTab={activePanel} onTabChange={(id) => setActivePanel(id as PanelId)} onOpenFolder={handleOpenFolder} />}
      statusBar={
        <StatusBar
          repoPath={repoPath}
          currentBranch={gitStatus?.current}
          modifiedCount={modifiedCount}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      }
    >
      {renderPanel(activePanel)}
      <ToastHost />
      <TooltipHost />

      {updateReady && (
        <div style={{
          position: 'fixed', bottom: '28px', right: '16px', zIndex: 300,
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px', background: 'var(--bg-card)',
          border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-md)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', fontFamily: 'var(--font-mono)',
          fontSize: '11px', color: 'var(--text-primary)'
        }}>
          <span>🔄 nuova versione scaricata</span>
          <button onClick={() => window.electronAPI.updater.install()}
            style={{
              padding: '5px 12px', background: 'var(--accent-color)', color: 'var(--text-inverse)',
              border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 600
            }}>
            riavvia e aggiorna
          </button>
        </div>
      )}

      {showRecent && !detachedPanel && (
        <RecentReposDialog
          repos={recentRepos}
          onOpenRepo={(p) => { handleRepoSelected(p); setShowRecent(false) }}
          onOpenFolder={async () => { await handleOpenFolder(); setShowRecent(false) }}
          onSkip={() => setShowRecent(false)}
          onClear={() => { clearRepos(); setShowRecent(false) }}
        />
      )}
    </AppShell>
  )
}
