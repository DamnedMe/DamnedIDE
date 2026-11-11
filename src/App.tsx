import { useState, useEffect, useMemo, useRef } from 'react'
import { AppShell } from './components/layout/AppShell'
import { TitleBar, TitleBarTab } from './components/layout/TitleBar'
import { StatusBar } from './components/layout/StatusBar'
import { WorktreePanel } from './components/worktree/WorktreePanel'
import { GitPanel } from './components/git/GitPanel'
import { AdoPanel } from './components/ado/AdoPanel'
import { PromotionPanel } from './components/ado/PromotionPanel'
import { SqlPanel } from './components/sql/SqlPanel'
import { CodeEditor } from './components/editor/CodeEditor'
import { TerminalPanel } from './components/terminal/TerminalPanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { ToastHost } from './components/layout/ToastHost'
import { TooltipHost } from './components/layout/TooltipHost'
import { RecentReposDialog } from './components/layout/RecentReposDialog'
import { RecentFoldersMenu } from './components/layout/RecentFoldersMenu'
import { GitTreeDialog } from './components/git/GitTreeDialog'
import { X, GitFork, FileCode, GitBranch, Cloud, Rocket, Database } from './components/icons'
import { useUIStore, useGitStore, useSettingsStore, useRecentReposStore, useSqlStore, useTerminalStore, useEditorStore, useWorktreeStore, useToastStore, useSettingsNavStore, migrateLegacyAdoStorage } from './store'
import { useI18n, tr } from './i18n'
import { hexToRgba } from './utils/color'
import { basenameOf } from './utils/paths'
import { appFontStack, ensureFontLoaded, uiTextScale } from './utils/fonts'
import { defineThemes, THEME_DARK, THEME_LIGHT } from './components/editor/monaco-theme'
import './styles/themes/dark.css'
import './styles/themes/light.css'

type PanelId = 'worktree' | 'git' | 'ado' | 'release' | 'sql' | 'editor' | 'terminal' | 'settings'

export default function App() {
  const [activePanel, setActivePanel] = useState<PanelId>(() => {
    // a detached window starts on its own panel (the gear switches it to Settings and back)
    const detached = window.location.hash.match(/^#\/panel\/(\w+)/)
    if (detached) return detached[1] as PanelId
    try {
      const p = localStorage.getItem('damnedide_last_panel')
      if (p && ['worktree', 'git', 'ado', 'release', 'sql', 'editor', 'settings', 'mcp'].includes(p)) return p as PanelId
    } catch { /* ignore */ }
    return 'worktree'
  })
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [showRecent, setShowRecent] = useState(false)
  // sidebar open-folder menu of recent repositories, anchored to the button
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number } | null>(null)
  // GitTree not found: its download URL, shows the download / locate dialog
  const [gitTreeDownloadUrl, setGitTreeDownloadUrl] = useState<string | null>(null)
    const { theme, setTheme } = useUIStore()
  const settingsTheme = useSettingsStore(s => s.settings.theme)
  const accentColor = useSettingsStore(s => s.settings.accentColor)
  const iconSize = useSettingsStore(s => s.settings.iconSize)
  const fontSize = useSettingsStore(s => s.settings.fontSize)
  const appFont = useSettingsStore(s => s.settings.appFont)
  const sqlQueryTimeout = useSettingsStore(s => s.settings.sqlQueryTimeout)
  const updateSettings = useSettingsStore(s => s.updateSettings)
  const gitStatus = useGitStore(s => s.status)
  const gitFiles = useGitStore(s => s.files)
  const modifiedCount = gitFiles.filter(f => !f.staged).length
  const selectedWorktree = useWorktreeStore(s => s.selectedWorktree)
  const setEditorRootPath = useEditorStore(s => s.setEditorRootPath)
  const editorNav = useEditorStore(s => s.editorNav)
  const sqlConnections = useSqlStore(s => s.connections)
  const themesDefined = useRef(false)
  const recentRepos = useRecentReposStore(s => s.repos)
  const addRepo = useRecentReposStore(s => s.addRepo)
  const clearRepos = useRecentReposStore(s => s.clearRepos)
  const showToast = useToastStore(s => s.showToast)

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

  // Propose opening a recent repo at startup (up to the last 5 opened).
  useEffect(() => {
    if (useRecentReposStore.getState().repos.length > 0) setShowRecent(true)
  }, [])

  // One time: the old localStorage ADO configuration (plaintext PATs) moves to
  // the main-process settings.
  useEffect(() => {
    void migrateLegacyAdoStorage()
  }, [])

  // Settings › SQL › query timeout: the main process opens (and reopens) its pools with it.
  // Declared before the reconnect below, so the startup pools already get it.
  useEffect(() => {
    void window.electronAPI.sql.setQueryTimeout(sqlQueryTimeout)
  }, [sqlQueryTimeout])

  // Reconnect persisted SQL connections on startup so they are available instantly.
  useEffect(() => {
    const conns = useSqlStore.getState().connections
    if (conns.length === 0) return
    let cancelled = false
    ;(async () => {
      for (const c of conns) {
        if (cancelled || c.isConnected) continue
        try {
          // already open (by another window): attach. A reconnect closes the shared pool first, and
          // with a password that is not saved it then fails, leaving every window disconnected
          // a detached window never reconnects: the user may have disconnected it in the main window
          if (!(await window.electronAPI.sql.isConnected(c.id))) {
            if (detachedPanel) continue
            await window.electronAPI.sql.connect({ ...c, connectionId: c.id })
          }
          if (cancelled) break
          useSqlStore.getState().updateConnection(c.id, { isConnected: true })
        } catch { /* server offline */ }
      }
    })()
    return () => { cancelled = true }
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
  const openRepo = async (path: string): Promise<string | null> => {
    const root = await window.electronAPI.git.resolveRepoRoot(path).catch(() => null)
    if (!root) {
      // a recent folder that was moved or deleted leaves the recents list
      const recents = useRecentReposStore.getState()
      const wasRecent = recents.repos.includes(path)
      if (wasRecent) recents.removeRepo(path)
      showToast(wasRecent
        ? tr('"{path}" is not a git repository: choose the folder that contains .git (removed from recents)', { path })
        : tr('"{path}" is not a git repository: choose the folder that contains .git', { path }), 'error')
      return null
    }
    handleRepoSelected(root)
    return root
  }

  // Resolves to the opened repository root, or null when nothing was opened.
  const handleOpenFolder = async (): Promise<string | null> => {
    // Any failure (dialog error, path not a repository) must never leave the
    // caller's flow stuck with a modal overlay covering the window.
    try {
      const p = await window.electronAPI.dialog.openFolder()
      if (p) return await openRepo(p)
    } catch (e) {
      showToast((e as Error).message || tr('opening the folder failed'), 'error')
    }
    return null
  }

  // Opens the selected worktree (or the repo root; GitTree needs a working-tree
  // root) in GitTree. Only on a user action: restoring the last panel at
  // startup and remote panel changes do not launch it.
  const openInGitTree = async () => {
    try {
      const target = useWorktreeStore.getState().selectedWorktree ?? repoPath ?? await handleOpenFolder()
      if (!target) return
      const saved = useSettingsStore.getState().settings.gitTreePath
      const res = await window.electronAPI.gitTree.open(target, saved || undefined)
      if (res.notFound) { setGitTreeDownloadUrl(res.downloadUrl ?? ''); return }
      if (!res.ok) { showToast(res.error || tr('starting GitTree failed'), 'error'); return }
      if (res.path && res.path !== saved) updateSettings({ gitTreePath: res.path })
      showToast(tr('opened in GitTree'))
    } catch (e) {
      showToast((e as Error).message || tr('starting GitTree failed'), 'error')
    }
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

  // A panel opened in a new window from the title bar starts on the repository (and the
  // worktree) of the window it came from: main.ts puts them in the hash.
  useEffect(() => {
    if (!detachedPanel) return
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    const repo = params.get('repo')
    const worktree = params.get('wt')
    if (repo) void openRepo(repo).then((root) => { if (root && worktree) useWorktreeStore.getState().selectWorktree(worktree) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── DamnedCloud: mirror the desktop workspace to the remote bridge ────────
  useEffect(() => {
    // the main window owns the mirror: a detached window would overwrite it with its own panel
    if (detachedPanel) return
    window.electronAPI.remote?.setWorkspace({
      repoPath,
      selectedWorktree,
      activePanel,
      editorNav
    }).catch(() => { /* bridge not active */ })
  }, [repoPath, selectedWorktree, activePanel, editorNav])

  // SQL connection metadata (sanitised) so paired devices can browse the
  // databases already open on the desktop without ever receiving credentials.
  useEffect(() => {
    if (detachedPanel) return
    window.electronAPI.remote?.setSqlConnections(
      sqlConnections.map(c => ({ id: c.id, label: c.label, server: c.server, database: c.database, isConnected: c.isConnected }))
    ).catch(() => { /* bridge not active */ })
  }, [sqlConnections])

  // Notify paired devices when git state changes so their lists stay fresh.
  useEffect(() => {
    window.electronAPI.remote?.broadcast('git.changed', { repoPath }).catch(() => { /* bridge not active */ })
  }, [gitStatus, gitFiles, repoPath])

  // Apply UI changes requested by a remote device (mirror): to the main window only.
  useEffect(() => {
    if (detachedPanel) return
    const off = window.electronAPI.remote?.onApply((change) => {
      switch (change.type) {
        case 'workspace.setRepo':
          void openRepo(change.repoPath)
          break
        case 'workspace.openWorktree':
          useWorktreeStore.getState().selectWorktree(change.path)
          setActivePanel('worktree')
          break
        case 'editor.open':
          setEditorRootPath(change.rootPath)
          useEditorStore.getState().setEditorNav({
            rootPath: change.rootPath,
            filePath: change.filePath,
            line: change.line ?? 1,
            previewMd: change.previewMd
          })
          setActivePanel('editor')
          break
        case 'panel':
          setActivePanel(change.panel as PanelId)
          break
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleTheme = () => {
    // the settings store drives data-theme (and syncs the editors), so the
    // status-bar toggle must write there, not only to the UI store
    updateSettings({ theme: settingsTheme === 'dark' ? 'light' : 'dark' })
  }

  // Remember the last active panel at startup.
  useEffect(() => {
    if (detachedPanel) return
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

  // Global icon scale (.app-icon zoom) and IDE text scale from settings. The font size
  // scales ONLY the IDE UI text (inline font sizes use var(--ui-text-scale) via
  // calc); source editors (Monaco), icons and layout are not affected.
  useEffect(() => {
    document.documentElement.style.setProperty('--icon-zoom', String(iconSize / 14))
  }, [iconSize])

  // Global font family: one family for the whole IDE (UI, SQL, editors,
  // terminal). Google Fonts are fetched on demand, offline it falls back.
  useEffect(() => {
    document.documentElement.style.setProperty('--app-font', appFontStack(appFont))
    ensureFontLoaded(appFont)
  }, [appFont])

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-text-scale', String(uiTextScale(fontSize)))
  }, [fontSize])

  const t = useI18n()
  // short visible labels; the title keeps t(id), the panel name used by the title and tests
  const tabs: TitleBarTab[] = [
    { id: 'worktree', label: 'Worktree', icon: GitFork, title: t('worktree'), tip: t('manage git worktrees (feature/bugfix)') },
    { id: 'editor', label: 'Editor', icon: FileCode, title: t('editor'), tip: t('code editor with C# navigation and references') },
    { id: 'sql', label: 'SQL', icon: Database, title: t('sql'), tip: t('SQL Server connections, queries and schema') },
    { id: 'git', label: 'Git', icon: GitBranch, title: t('git'), tip: t('open the repository (or the selected worktree) in GitTree; stage and commit here') },
    { id: 'ado', label: 'DevOps', icon: Cloud, title: t('ado'), tip: t('work items and pull requests from Azure DevOps') },
    { id: 'release', label: t('Release'), icon: Rocket, title: t('release'), tip: t('promote develop → qa → prod with Azure DevOps pull requests (BE/FE)') }
  ]

  const lastPanelRef = useRef<PanelId>('worktree')
  const handleSettingsToggle = () => {
    setActivePanel(prev => {
      if (prev === 'settings') return lastPanelRef.current
      lastPanelRef.current = prev
      return 'settings'
    })
  }

  // openSettings(page) from any panel: same path as the gear (the gear then goes back)
  const settingsRequest = useSettingsNavStore(s => s.request)
  useEffect(() => {
    if (settingsRequest === 0) return
    setActivePanel(prev => {
      if (prev === 'settings') return prev
      lastPanelRef.current = prev
      return 'settings'
    })
  }, [settingsRequest])

  const renderPanel = (panel: PanelId) => {
    switch (panel) {
      case 'worktree':
        return <WorktreePanel repoPath={repoPath} onRepoSelected={openRepo} />
      case 'git':
        return <GitPanel repoPath={repoPath} />
      case 'ado':
        // keyed: switching repository starts from that repository's connection
        return <AdoPanel key={repoPath ?? ''} repoPath={repoPath} />
      case 'release':
        // not configured / repository unclear: its chooser opens Settings › Azure DevOps itself
        return <PromotionPanel key={repoPath ?? ''} repoPath={repoPath} />
      case 'sql':
        return <SqlPanel />
      case 'editor':
        return <CodeEditor />
      case 'terminal':
        return <TerminalPanel repoPath={repoPath} />
      case 'settings':
        return <SettingsPanel repoPath={repoPath} />
    }
  }

  if (detachedPanel) {
    return (
      <AppShell
        titleBar={<TitleBar title={`DamnedIDE — ${t(detachedPanel)}${repoPath ? ` · ${basenameOf(repoPath)}` : ''}`} onSettings={handleSettingsToggle} settingsActive={activePanel === 'settings'} />}
        statusBar={null}
        contentPadding="6px 8px"
      >
        {renderPanel(activePanel === 'settings' ? 'settings' : detachedPanel)}
        <ToastHost />
        <TooltipHost />
      </AppShell>
    )
  }

  return (
    <AppShell
      titleBar={
        <TitleBar
          title={t(activePanel)}
          onSettings={handleSettingsToggle}
          settingsActive={activePanel === 'settings'}
          tabs={tabs}
          activeTab={activePanel}
          onTabChange={(id) => { setActivePanel(id as PanelId); if (id === 'git') void openInGitTree() }}
          onTabOpenWindow={(id) => { void window.electronAPI.window.openDetached(id, { repoPath, worktree: selectedWorktree }) }}
          repoLabel={repoPath ? basenameOf(repoPath) : t('open repo')}
          onRepoClick={(a) => { if (recentRepos.length) setFolderMenu(a); else void handleOpenFolder() }}
        />
      }
      // the worktree view is drawn edge to edge: its own strip and borders frame it
      contentPadding={activePanel === 'worktree' ? '0' : '8px 10px'}
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

      <UpdateBanner />

      {showRecent && !detachedPanel && (
        <RecentReposDialog
          repos={recentRepos}
          onOpenRepo={(p) => { void openRepo(p); setShowRecent(false) }}
          onOpenFolder={async () => { await handleOpenFolder(); setShowRecent(false) }}
          onSkip={() => setShowRecent(false)}
          onClear={() => { clearRepos(); setShowRecent(false) }}
        />
      )}

      {folderMenu && (
        <RecentFoldersMenu
          anchor={folderMenu}
          currentPath={repoPath}
          onOpen={(p) => void openRepo(p)}
          onBrowse={() => void handleOpenFolder()}
          onClose={() => setFolderMenu(null)}
        />
      )}

      {gitTreeDownloadUrl !== null && (
        <GitTreeDialog
          downloadUrl={gitTreeDownloadUrl}
          onRetry={() => { setGitTreeDownloadUrl(null); void openInGitTree() }}
          onClose={() => setGitTreeDownloadUrl(null)}
        />
      )}
    </AppShell>
  )
}

const bannerText = (n: number) => `calc(${n}px * var(--ui-text-scale, 1))`

/**
 * Bottom-right update banner, driven by the main-process update state: a newer
 * version is known → one click "installa la versione X" (download if needed +
 * install); managed Linux installed → "riavvia ora". Details (errors, log) are in
 * Settings › Aggiornamenti. Nothing in an instance that does not own the updater.
 */
function UpdateBanner() {
  const showToast = useToastStore(s => s.showToast)
  const t = useI18n()
  const [st, setSt] = useState<UpdateState | null>(null)
  const [busy, setBusy] = useState(false)
  // closed for this version / this pending restart
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.updater.state().then(setSt).catch(() => { /* main not ready */ })
    return window.electronAPI.updater.onState(setSt)
  }, [])

  if (!st || !st.packaged || st.ownerElsewhere) return null
  const restartFor = st.pendingRestart
  const installable = !!st.version && !(st.managed && st.selfInstall === false)
    && (st.status === 'available' || st.status === 'downloading' || st.status === 'downloaded' || st.status === 'installing')
  if (!restartFor && !installable) return null
  const key = restartFor ? `restart:${restartFor}` : `install:${st.version}`
  if (dismissed === key) return null

  const installing = busy || st.status === 'installing'
  const install = async () => {
    setBusy(true)
    try {
      const res = await window.electronAPI.updater.installLatest()
      if (!res.ok) showToast(tr('{error} — details in Settings › Updates', { error: res.error || tr('update install failed') }), 'error')
      else if (res.upToDate) showToast(tr('you are already on the latest version'))
    } catch (e) {
      showToast((e as Error).message || tr('update install failed'), 'error')
    } finally {
      setBusy(false)
    }
  }
  const restart = () => {
    window.electronAPI.updater.restart().catch(e => showToast((e as Error).message || tr('restart failed'), 'error'))
  }

  const version = st.version ?? ''
  const message = restartFor ? t('version {version} installed', { version: restartFor })
    : installing ? (st.managed ? t('installing {version} (pkexec asks for the password)…', { version }) : t('installing {version}…', { version }))
      : st.status === 'downloading' ? t('new version {version} — downloading {progress}%', { version, progress: st.progress ?? 0 })
        : st.status === 'downloaded' ? t('new version {version} downloaded', { version })
          : t('new version {version} available', { version })
  const buttonStyle = {
    padding: '5px 12px', background: 'var(--accent-color)', color: 'var(--text-inverse)',
    border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', whiteSpace: 'nowrap' as const,
    fontSize: bannerText(10), fontFamily: 'var(--font-mono)', fontWeight: 600
  }

  return (
    <div role="status" style={{
      position: 'fixed', bottom: '28px', right: '16px', zIndex: 300, maxWidth: 'min(520px, calc(100vw - 32px))',
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 10px',
      padding: '10px 14px', background: 'var(--bg-card)',
      border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-md)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)', fontFamily: 'var(--font-mono)',
      fontSize: bannerText(11), color: 'var(--text-primary)'
    }}>
      {installing && (
        <span aria-hidden style={{
          width: bannerText(10), height: bannerText(10), flexShrink: 0, borderRadius: '50%',
          border: '2px solid var(--accent-color)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite'
        }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: '1 1 180px' }}>
        <span>{message}</span>
        {restartFor && (
          <span style={{ fontSize: bannerText(9.5), color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {t('close the other DamnedIDE windows too: they still run the previous version')}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', flexShrink: 0 }}>
        {restartFor ? (
          <button onClick={restart} style={buttonStyle}
            title={t('restart DamnedIDE on version {version}', { version: restartFor })} data-tip-desc={t('relaunch the IDE on the installed version')}>
            {t('restart now')}
          </button>
        ) : !installing && (
          <button onClick={() => void install()} style={buttonStyle}
            title={st.managed
              ? t('install version {version} with the package manager (pkexec asks for the administrator password)', { version })
              : t('install version {version}: DamnedIDE closes, updates and reopens', { version })}
            data-tip-desc={t('downloads the update when needed, then installs it')}>
            {t('install version {version}', { version })}
          </button>
        )}
        <button onClick={() => setDismissed(key)} aria-label={t('later')}
          title={t('later')} data-tip-desc={t('hide this banner; Settings › Updates keeps the update')}
          style={{
            display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
            color: 'var(--text-muted)'
          }}>
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
