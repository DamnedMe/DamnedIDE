import { create } from 'zustand'
import { WorktreeEntry, WorktreeWithStatus } from '../types/worktree'
import { GitStatus, GitFileStatus, BranchInfo, CommitInfo } from '../types/git'
import { AdoConnection, AdoWorkItem, AdoPullRequest } from '../types/ado'
import {
  SqlConnection,
  SqlExecutionResult,
  SqlColumnInfo,
  SqlRecentConnection
} from '../types/sql'

interface UIState {
  activePanel: string
  sidebarCollapsed: boolean
  theme: 'dark' | 'light'
  setActivePanel: (panel: string) => void
  toggleSidebar: () => void
  setTheme: (theme: 'dark' | 'light') => void
}

interface WorktreeState {
  entries: WorktreeEntry[]
  entriesWithStatus: WorktreeWithStatus[]
  selectedWorktree: string | null
  isLoading: boolean
  setEntries: (entries: WorktreeEntry[]) => void
  setEntriesWithStatus: (entries: WorktreeWithStatus[]) => void
  selectWorktree: (path: string | null) => void
  setLoading: (loading: boolean) => void
}

interface GitState {
  status: GitStatus | null
  files: GitFileStatus[]
  branches: BranchInfo[]
  commits: CommitInfo[]
  stagedFiles: string[]
  isLoading: boolean
  setStatus: (status: GitStatus | null) => void
  setFiles: (files: GitFileStatus[]) => void
  setBranches: (branches: BranchInfo[]) => void
  setCommits: (commits: CommitInfo[]) => void
  setStagedFiles: (files: string[]) => void
  setLoading: (loading: boolean) => void
}

interface AdoState {
  connection: AdoConnection | null
  workItems: AdoWorkItem[]
  pullRequests: AdoPullRequest[]
  isLoading: boolean
  setConnection: (connection: AdoConnection | null) => void
  setWorkItems: (workItems: AdoWorkItem[]) => void
  setPullRequests: (prs: AdoPullRequest[]) => void
  setLoading: (loading: boolean) => void
}

const ADO_CONNECTION_KEY = 'damnedide_ado_connection'

function loadAdoConnection(): AdoConnection | null {
  try {
    const raw = localStorage.getItem(ADO_CONNECTION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.isConnected) return parsed as AdoConnection
    }
  } catch { /* ignore */ }
  return null
}

function saveAdoConnection(conn: AdoConnection | null) {
  try {
    if (conn) localStorage.setItem(ADO_CONNECTION_KEY, JSON.stringify(conn))
    else localStorage.removeItem(ADO_CONNECTION_KEY)
  } catch { /* ignore */ }
}

interface SqlState {
  connections: SqlConnection[]
  activeConnection: string | null
  activeDatabases: Record<string, string>
  execution: SqlExecutionResult | null
  isRunning: boolean
  runningQueryId: string | null
  isLoading: boolean
  addConnection: (conn: SqlConnection) => void
  updateConnection: (id: string, patch: Partial<SqlConnection>) => void
  removeConnection: (id: string) => void
  setActiveConnection: (id: string | null) => void
  setActiveDatabase: (connId: string, database: string) => void
  setExecution: (execution: SqlExecutionResult | null) => void
  setRunning: (queryId: string | null) => void
  setLoading: (loading: boolean) => void
}

const SQL_CONNECTIONS_KEY = 'damnedide_sql_connections'
const SQL_RECENT_KEY = 'damnedide_sql_recent'
const SQL_RECENT_MAX = 10

function loadSqlConnections(): SqlConnection[] {
  try {
    const raw = localStorage.getItem(SQL_CONNECTIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map((c) => ({
          authType: 'sql',
          ...c,
          isConnected: false,
          lastConnected: typeof c.lastConnected === 'number' ? c.lastConnected : undefined
        }))
      }
    }
  } catch { /* ignore */ }
  return []
}

function saveSqlConnections(connections: SqlConnection[]) {
  try {
    localStorage.setItem(SQL_CONNECTIONS_KEY, JSON.stringify(connections))
  } catch { /* ignore */ }
}

function loadSqlRecent(): SqlRecentConnection[] {
  try {
    const raw = localStorage.getItem(SQL_RECENT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.slice(0, SQL_RECENT_MAX)
    }
  } catch { /* ignore */ }
  return []
}

function saveSqlRecent(list: SqlRecentConnection[]) {
  try {
    localStorage.setItem(SQL_RECENT_KEY, JSON.stringify(list.slice(0, SQL_RECENT_MAX)))
  } catch { /* ignore */ }
}

export interface EditorNav {
  rootPath: string
  filePath: string
  line: number
}

interface EditorState {
  editorNav: EditorNav | null
  setEditorNav: (nav: EditorNav | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  activePanel: 'worktree',
  sidebarCollapsed: false,
  theme: 'dark',
  setActivePanel: (panel) => set({ activePanel: panel }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setTheme: (theme) => set({ theme })
}))

export const useWorktreeStore = create<WorktreeState>((set) => ({
  entries: [],
  entriesWithStatus: [],
  selectedWorktree: null,
  isLoading: false,
  setEntries: (entries) => set({ entries }),
  setEntriesWithStatus: (entries) => set({ entriesWithStatus: entries }),
  selectWorktree: (path) => set({ selectedWorktree: path }),
  setLoading: (loading) => set({ isLoading: loading })
}))

export const useGitStore = create<GitState>((set) => ({
  status: null,
  files: [],
  branches: [],
  commits: [],
  stagedFiles: [],
  isLoading: false,
  setStatus: (status) => set({ status }),
  setFiles: (files) => set({ files }),
  setBranches: (branches) => set({ branches }),
  setCommits: (commits) => set({ commits }),
  setStagedFiles: (stagedFiles) => set({ stagedFiles }),
  setLoading: (loading) => set({ isLoading: loading })
}))

export const useAdoStore = create<AdoState>((set) => ({
  connection: loadAdoConnection(),
  workItems: [],
  pullRequests: [],
  isLoading: false,
  setConnection: (connection) => {
    saveAdoConnection(connection)
    set({ connection })
  },
  setWorkItems: (workItems) => set({ workItems }),
  setPullRequests: (pullRequests) => set({ pullRequests }),
  setLoading: (loading) => set({ isLoading: loading })
}))

export const useSqlStore = create<SqlState>((set) => ({
  connections: loadSqlConnections(),
  activeConnection: null,
  activeDatabases: {},
  execution: null,
  isRunning: false,
  runningQueryId: null,
  isLoading: false,
  addConnection: (conn) => set((s) => {
    const connections = [...s.connections, conn]
    saveSqlConnections(connections)
    return { connections }
  }),
  updateConnection: (id, patch) => set((s) => {
    const connections = s.connections.map((c) => c.id === id ? { ...c, ...patch } : c)
    saveSqlConnections(connections)
    return { connections }
  }),
  removeConnection: (id) => set((s) => {
    const connections = s.connections.filter((c) => c.id !== id)
    saveSqlConnections(connections)
    return {
      connections,
      activeConnection: s.activeConnection === id ? null : s.activeConnection
    }
  }),
  setActiveConnection: (id) => set({ activeConnection: id }),
  setActiveDatabase: (connId, database) => set((s) => ({
    activeDatabases: { ...s.activeDatabases, [connId]: database }
  })),
  setExecution: (execution) => set({ execution }),
  setRunning: (runningQueryId) => set({ isRunning: !!runningQueryId, runningQueryId }),
  setLoading: (loading) => set({ isLoading: loading })
}))

// ─── SQL Object Explorer cache ──────────────────────────────────────────────
// Keys: `<connId>:databases`, `<connId>:tables:<db>`, `<connId>:views:<db>`,
//       `<connId>:procedures:<db>`, `<connId>:columns:<db>:<table>`
export interface SqlExplorerEntry {
  loaded: boolean
  loading: boolean
  error?: string
  data: string[] | SqlColumnInfo[] | null
}

interface SqlExplorerState {
  cache: Record<string, SqlExplorerEntry>
  setEntry: (key: string, entry: Partial<SqlExplorerEntry>) => void
  invalidate: (key: string) => void
  invalidateConnection: (connId: string) => void
  clear: () => void
}

export const useSqlExplorerStore = create<SqlExplorerState>((set) => ({
  cache: {},
  setEntry: (key, entry) => set((s) => ({
    cache: { ...s.cache, [key]: { ...(s.cache[key] || { loaded: false, loading: false, data: null }), ...entry } }
  })),
  invalidate: (key) => set((s) => {
    const cache = { ...s.cache }
    delete cache[key]
    return { cache }
  }),
  invalidateConnection: (connId) => set((s) => {
    const cache: Record<string, SqlExplorerEntry> = {}
    for (const k of Object.keys(s.cache)) {
      if (!k.startsWith(`${connId}:`)) cache[k] = s.cache[k]
    }
    return { cache }
  }),
  clear: () => set({ cache: {} })
}))

interface SqlRecentState {
  recent: SqlRecentConnection[]
  addRecent: (c: SqlRecentConnection) => void
  clearRecent: () => void
}

export const useSqlRecentStore = create<SqlRecentState>((set) => ({
  recent: loadSqlRecent(),
  addRecent: (c) => set((s) => {
    const next = [c, ...s.recent.filter(r => r.server !== c.server || r.database !== c.database)].slice(0, SQL_RECENT_MAX)
    saveSqlRecent(next)
    return { recent: next }
  }),
  clearRecent: () => {
    saveSqlRecent([])
    return { recent: [] }
  }
}))

export interface ThemeColorConfig {
  keyword: string
  controlFlow: string
  linq: string
  type: string
  identifier: string
  namespace: string
  number: string
  string: string
  comment: string
  delimiter: string
  method: string
  staticClass: string
}

export const DEFAULT_DARK_COLORS: ThemeColorConfig = {
  keyword: '#d2a8ff',
  controlFlow: '#ff7b72',
  linq: '#ff7b72',
  type: '#4ec9b0',
  identifier: '#c9d1d9',
  namespace: '#79c0ff',
  number: '#d2a8ff',
  string: '#a5d6ff',
  comment: '#8b949e',
  delimiter: '#ff7b72',
  method: '#dcdcaa',
  staticClass: '#79c0ff'
}

export const DEFAULT_LIGHT_COLORS: ThemeColorConfig = {
  keyword: '#7722ee',
  controlFlow: '#cc2244',
  linq: '#cc2244',
  type: '#008855',
  identifier: '#111122',
  namespace: '#0055dd',
  number: '#7722ee',
  string: '#0088cc',
  comment: '#8899aa',
  delimiter: '#cc2244',
  method: '#bb7700',
  staticClass: '#0055dd'
}

export interface AppSettings {
  theme: 'dark' | 'light'
  fontSize: number
  iconSize: number
  language: 'en' | 'it'
  minimap: boolean
  tabSize: number
  autoSave: boolean
  lineNumbers: 'on' | 'off' | 'relative'
  wordWrap: 'on' | 'off'
  fontLigatures: boolean
  navKeybindings: 'vs-studio' | 'vs-code'
  accentColor: string
  themeColors: {
    dark: ThemeColorConfig
    light: ThemeColorConfig
  }
}

// The user's chosen theme standard: primary color + editor colors.
// Persisted separately so "reset default theme settings" can restore it.
export interface ThemeDefaults {
  accentColor: string
  themeColors: AppSettings['themeColors']
}

const THEME_DEFAULTS_KEY = 'damnedide_theme_defaults'

function loadThemeDefaults(): ThemeDefaults | null {
  try {
    const raw = localStorage.getItem(THEME_DEFAULTS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p && typeof p.accentColor === 'string' && p.themeColors?.dark && p.themeColors?.light) return p
    }
  } catch { /* ignore */ }
  return null
}

function saveThemeDefaults(d: ThemeDefaults) {
  try { localStorage.setItem(THEME_DEFAULTS_KEY, JSON.stringify(d)) } catch { /* ignore */ }
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontSize: 12.5,
  iconSize: 14,
  language: 'en',
  minimap: true,
  tabSize: 2,
  autoSave: false,
  lineNumbers: 'on',
  wordWrap: 'off',
  fontLigatures: false,
  navKeybindings: 'vs-studio',
  accentColor: '#00ffff',
  themeColors: {
    dark: { ...DEFAULT_DARK_COLORS },
    light: { ...DEFAULT_LIGHT_COLORS }
  }
}

interface SettingsState {
  settings: AppSettings
  themeDefaults: ThemeDefaults
  updateSettings: (patch: Partial<AppSettings>) => void
  resetSettings: () => void
  setThemeDefaults: () => void
  resetThemeToDefaults: () => void
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('damnedide_settings')
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        themeColors: {
          dark: { ...DEFAULT_DARK_COLORS, ...(parsed.themeColors?.dark || {}) },
          light: { ...DEFAULT_LIGHT_COLORS, ...(parsed.themeColors?.light || {}) }
        }
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS
}

function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem('damnedide_settings', JSON.stringify(s))
  } catch { /* ignore */ }
}

export const useSettingsStore = create<SettingsState>((set) => {
  const settings = loadSettings()
  // On first run with this feature, the user's CURRENT theme config becomes the standard.
  const existingDefaults = loadThemeDefaults()
  const themeDefaults = existingDefaults ?? { accentColor: settings.accentColor, themeColors: settings.themeColors }
  if (!existingDefaults) saveThemeDefaults(themeDefaults)

  return {
    settings,
    themeDefaults,
    updateSettings: (patch) => set((state) => {
      const next = { ...state.settings, ...patch }
      saveSettings(next)
      return { settings: next }
    }),
    resetSettings: () => {
      saveSettings(DEFAULT_SETTINGS)
      return { settings: DEFAULT_SETTINGS }
    },
    setThemeDefaults: () => set((state) => {
      const td: ThemeDefaults = { accentColor: state.settings.accentColor, themeColors: state.settings.themeColors }
      saveThemeDefaults(td)
      return { themeDefaults: td }
    }),
    resetThemeToDefaults: () => set((state) => {
      const next = {
        ...state.settings,
        accentColor: state.themeDefaults.accentColor,
        themeColors: state.themeDefaults.themeColors
      }
      saveSettings(next)
      return { settings: next }
    })
  }
})

export const useEditorStore = create<EditorState>((set) => ({
  editorNav: null,
  setEditorNav: (nav) => set({ editorNav: nav })
}))

interface TerminalState {
  open: boolean
  height: number
  setOpen: (open: boolean) => void
  setHeight: (h: number) => void
}

function defaultTerminalHeight(): number {
  try {
    const inner = window.innerHeight - 54
    return Math.max(120, Math.round((inner - 32) / 2))
  } catch { /* ignore */ }
  return 280
}

export const useTerminalStore = create<TerminalState>((set) => ({
  open: false,
  height: defaultTerminalHeight(),
  setOpen: (open) => set({ open }),
  setHeight: (height) => set({ height })
}))

const RECENT_REPOS_KEY = 'damnedide_recent_repos'
const RECENT_REPOS_MAX = 5

function loadRecentRepos(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_REPOS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter((p) => typeof p === 'string').slice(0, RECENT_REPOS_MAX)
    }
  } catch { /* ignore */ }
  return []
}

function saveRecentRepos(list: string[]) {
  try {
    localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(list.slice(0, RECENT_REPOS_MAX)))
  } catch { /* ignore */ }
}

interface RecentReposState {
  repos: string[]
  addRepo: (path: string) => void
  clearRepos: () => void
}

export const useRecentReposStore = create<RecentReposState>((set) => ({
  repos: loadRecentRepos(),
  addRepo: (path) => set((s) => {
    const next = [path, ...s.repos.filter((p) => p !== path)].slice(0, RECENT_REPOS_MAX)
    saveRecentRepos(next)
    return { repos: next }
  }),
  clearRepos: () => {
    saveRecentRepos([])
    return { repos: [] }
  }
}))

const DIFF_KEY = 'damnedide_diff'

interface DiffState {
  fontSize: number
  sideBySide: boolean
  setFontSize: (n: number) => void
  setSideBySide: (b: boolean) => void
}

function loadDiffState(): { fontSize: number; sideBySide: boolean } {
  try {
    const raw = localStorage.getItem(DIFF_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return {
        fontSize: typeof p.fontSize === 'number' ? p.fontSize : 12.5,
        sideBySide: typeof p.sideBySide === 'boolean' ? p.sideBySide : true
      }
    }
  } catch { /* ignore */ }
  return { fontSize: 12.5, sideBySide: true }
}

function saveDiffState(s: { fontSize: number; sideBySide: boolean }) {
  try { localStorage.setItem(DIFF_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

export const useDiffStore = create<DiffState>((set) => ({
  ...loadDiffState(),
  setFontSize: (n) => set((s) => { saveDiffState({ fontSize: n, sideBySide: s.sideBySide }); return { fontSize: n } }),
  setSideBySide: (b) => set((s) => { saveDiffState({ fontSize: s.fontSize, sideBySide: b }); return { sideBySide: b } })
}))

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

interface ToastState {
  toasts: Toast[]
  showToast: (message: string, type?: Toast['type']) => void
  removeToast: (id: number) => void
}

let toastId = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (message, type = 'success') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 3500)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
