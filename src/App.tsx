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
import { useUIStore, useGitStore, useSettingsStore, useAdoStore, useRecentReposStore, useSqlStore, useTerminalStore, useEditorStore, useWorktreeStore, useToastStore } from './store'
import { useI18n } from './i18n'
import { hexToRgba } from './utils/color'
import { defineThemes, THEME_DARK, THEME_LIGHT } from './components/editor/monaco-theme'
import {
  GitBranch,
  Network,
  Database,
  Code2,
  Boxes
} from 'lucide-react'
import './styles/themes/dark.css'
import './styles/themes/light.css'

type PanelId = 'worktree' | 'git' | 'ado' | 'sql' | 'editor' | 'terminal' | 'settings'

export default function App() {
  const [activePanel, setActivePanel] = useState<PanelId>(() => {
    try {
      const p = localStorage.getItem('damnedide_last_panel')
      if (p && ['worktree', 'git', 'ado', 'sql', 'editor', 'settings', 'mcp'].includes(p)) return p as PanelId
    } catch { /* ignore */ }
    return 'worktree'
  })
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
  const selectedWorktree = useWorktreeStore(s => s.selectedWorktree)
  const setEditorRootPath = useEditorStore(s => s.setEditorRootPath)
  const themesDefined = useRef(false)
  const recentRepos = useRecentReposStore(s => s.repos)
  const addRepo = useRecentReposStore(s => s.addRepo)
  const clearRepos = useRecentReposStore(s => s.clearRepos)
  const showToast = useToastStore(s => s.showToast)
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

  // The editor must follow an explicitly selected worktree, while keeping the
  // repository folder when the user only changes panels or settings.
  useEffect(() => {
    if (selectedWorktree) setEditorRootPath(selectedWorktree)
  }, [selectedWorktree, setEditorRootPath])

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
    useWorktreeStore.getState().selectWorktree(null)
    setEditorRootPath(path)
    setRepoPath(path)
  }

  // Opening a folder resolves its git root first (a subfolder of a working tree
  // resolves to the root) and says so when the folder is not in a repository,
  // instead of letting the worktree operations fail later.
  const openRepo = async (path: string) => {
    const root = await window.electronAPI.git.resolveRepoRoot(path).catch(() => null)
    if (!root) {
      showToast(`"${path}" non è un repository git: scegli la cartella che contiene .git`, 'error')
      return
    }
    handleRepoSelected(root)
  }

  const handleOpenFolder = async () => {
    const p = await window.electronAPI.dialog.openFolder()
    if (p) await openRepo(p)
  }

  // Open a folder / file handed over by the OS ("Open with DamnedIDE"): a
  // directory becomes the repository, a file opens in the editor (.md straight
  // into the rendered preview).
  const handleOpenTarget = (target: { path: string; isDirectory: boolean }) => {
    if (target.isDirectory) {
      void openRepo(target.path)
      setActivePanel('worktree')
      return
    }
    const dir = target.path.replace(/[\\/][^\\/]*$/, '')
    setEditorRootPath(dir)
    setActivePanel('editor')
    useEditorStore.getState().setEditorNav({
      rootPath: dir,
      filePath: target.path,
      line: 1,
      previewMd: /\.(md|markdown)$/i.test(target.path)
    })
  }

  useEffect(() => {
    window.electronAPI.app.initialTarget().then((t) => { if (t) handleOpenTarget(t) }).catch(() => { /* no target */ })
    return window.electronAPI.app.onOpenPath(handleOpenTarget)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleTheme = () => {
    // the settings store drives data-theme (and syncs the editors), so the
    // status-bar toggle must write there, not only to the UI store
    updateSettings({ theme: settingsTheme === 'dark' ? 'light' : 'dark' })
  }

  // Remember the last active panel at startup.
  useEffect(() => {
    try { localStorage.setItem('damnedide_last_panel', activePanel) } catch { /* ignore */ }
  }, [activePanel])

  const dockMode = useTerminalStore(s => s.mode)
  const dockOpen = useTerminalStore(s => s.open)
  const handleTerminalToggle = () => {
    const { open, mode, setOpen, setMode } = useTerminalStore.getState()
    if (open && mode === 'terminal') setOpen(false)
    else { setMode('terminal'); setOpen(true) }
  }
  const handleAiToggle = () => {
    const { open, mode, setOpen, setMode } = useTerminalStore.getState()
    if (open && mode === 'ai') setOpen(false)
    else { setMode('ai'); setOpen(true) }
  }

  // Global icon scale (lucide) and IDE text scale from settings. The font size
  // scales ONLY the IDE UI text (inline font sizes use var(--ui-text-scale) via
  // calc); source editors (Monaco), icons and layout are not affected.
  useEffect(() => {
    document.documentElement.style.setProperty('--icon-zoom', String(iconSize / 14))
  }, [iconSize])

  useEffect(() => {
    const scale = Math.min(1.9, Math.max(0.6, fontSize / 12.5))
    document.documentElement.style.setProperty('--ui-text-scale', String(scale))
  }, [fontSize])

  const t = useI18n()
  const tabs: SidebarTab[] = [
    { id: 'worktree', icon: Boxes, label: t('worktree') },
    { id: 'editor', icon: Code2, label: t('editor') },
    { id: 'git', icon: GitBranch, label: t('git') },
    { id: 'ado', icon: Network, label: t('ado') },
    { id: 'sql', icon: Database, label: t('sql') }
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
        return <WorktreePanel repoPath={repoPath} onRepoSelected={openRepo} />
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
      titleBar={<TitleBar title={t(activePanel)} onSettings={handleSettingsToggle} settingsActive={activePanel === 'settings'} />}
      sidebar={<Sidebar tabs={tabs} activeTab={activePanel} onTabChange={(id) => setActivePanel(id as PanelId)} onOpenFolder={handleOpenFolder} />}
      statusBar={
        <StatusBar
          repoPath={repoPath}
          currentBranch={gitStatus?.current}
          modifiedCount={modifiedCount}
          theme={theme}
          onToggleTheme={toggleTheme}
          onToggleTerminal={handleTerminalToggle}
          terminalOpen={dockOpen && dockMode === 'terminal'}
          onToggleAi={handleAiToggle}
          aiOpen={dockOpen && dockMode === 'ai'}
        />
      }
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        {renderPanel(activePanel)}
      </div>
      <ToastHost />
      <TooltipHost />

      {updateReady && (
        <div style={{
          position: 'fixed', bottom: '28px', right: '16px', zIndex: 300,
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px', background: 'var(--bg-card)',
          border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-md)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', fontFamily: 'var(--font-mono)',
          fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-primary)'
        }}>
          <span>🔄 nuova versione scaricata</span>
          <button onClick={() => window.electronAPI.updater.install()}
            style={{
              padding: '5px 12px', background: 'var(--accent-color)', color: 'var(--text-inverse)',
              border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
            }}>
            riavvia e aggiorna
          </button>
        </div>
      )}

      {showRecent && !detachedPanel && (
        <RecentReposDialog
          repos={recentRepos}
          onOpenRepo={(p) => { void openRepo(p); setShowRecent(false) }}
          onOpenFolder={async () => { await handleOpenFolder(); setShowRecent(false) }}
          onSkip={() => setShowRecent(false)}
          onClear={() => { clearRepos(); setShowRecent(false) }}
        />
      )}
    </AppShell>
  )
}
