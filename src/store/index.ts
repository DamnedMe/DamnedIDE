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
  // open the markdown preview (e.g. a .md opened from the OS)
  previewMd?: boolean
}

interface EditorState {
  editorRootPath: string | null
  editorNav: EditorNav | null
  setEditorRootPath: (path: string | null) => void
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
  editorRootPath: null,
  editorNav: null,
  setEditorRootPath: (path) => set({ editorRootPath: path }),
  setEditorNav: (nav) => set({ editorNav: nav })
}))

interface TerminalState {
  open: boolean
  height: number
  mode: 'terminal' | 'ai'
  // command to type into the terminal as soon as it is ready (agent login)
  pendingCommand: string | null
  setOpen: (open: boolean) => void
  setHeight: (h: number) => void
  setMode: (m: 'terminal' | 'ai') => void
  runCommand: (command: string) => void
  takePendingCommand: () => string | null
}

function defaultTerminalHeight(): number {
  try {
    const inner = window.innerHeight - 54
    return Math.max(120, Math.round((inner - 32) / 2))
  } catch { /* ignore */ }
  return 280
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  open: false,
  height: defaultTerminalHeight(),
  mode: 'terminal',
  pendingCommand: null,
  setOpen: (open) => set({ open }),
  setHeight: (height) => set({ height }),
  setMode: (mode) => set({ mode }),
  // used by the agent settings to sign in on the provider platform: opens the
  // terminal (if closed) and runs the interactive login command there
  runCommand: (command) => set({ pendingCommand: command, mode: 'terminal', open: true }),
  takePendingCommand: () => {
    const command = get().pendingCommand
    if (command) set({ pendingCommand: null })
    return command
  }
}))

// ─── MCP servers (config + connection state, persisted) ───────────────────────
export interface McpServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
}

export const MCP_PRESETS: { label: string; config: McpServerConfig }[] = [
  // No agent presets: agent CLIs (Claude, opencode, Codex, Cursor) are now
  // first-class chat providers (see useAgentChatStore / AgentService), not MCP
  // chat servers. This panel is a generic MCP *client*: add any MCP server
  // (e.g. `npx -y @modelcontextprotocol/server-filesystem .`) and call its tools.
]

const MCP_CUSTOM_KEY = 'damnedide_mcp_servers'
const MCP_CONNECTED_KEY = 'damnedide_mcp_connected'
const MCP_CHATSEL_KEY = 'damnedide_mcp_chatsel'

export interface McpChatSelection {
  mode?: string
  model?: string
  effort?: string
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch { /* ignore */ }
  return fallback
}
function saveJson(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
}

interface McpState {
  custom: McpServerConfig[]
  connected: Record<string, boolean>
  status: Record<string, 'idle' | 'connecting' | 'connected' | 'error'>
  errors: Record<string, string>
  tools: Record<string, McpTool[]>
  addServer: (c: McpServerConfig) => void
  removeServer: (name: string) => void
  updateServer: (name: string, patch: Partial<McpServerConfig>) => void
  setConnected: (name: string, v: boolean) => void
  setStatus: (name: string, s: 'idle' | 'connecting' | 'connected' | 'error') => void
  setError: (name: string, e?: string) => void
  setTools: (name: string, tools: McpTool[]) => void
  chatSel: Record<string, McpChatSelection>
  setChatSel: (name: string, sel: McpChatSelection) => void
}

// The connected map is persisted by name, so a server that no longer exists
// (removed preset, deleted custom entry) would keep showing up in the chat
// provider list. Drop anything that is not a configured server any more.
function loadConnected(custom: McpServerConfig[]): Record<string, boolean> {
  const known = new Set([...MCP_PRESETS.map(p => p.config.name), ...custom.map(c => c.name)])
  const stored = loadJson<Record<string, boolean>>(MCP_CONNECTED_KEY, {})
  const pruned = Object.fromEntries(Object.entries(stored).filter(([name]) => known.has(name)))
  if (Object.keys(pruned).length !== Object.keys(stored).length) saveJson(MCP_CONNECTED_KEY, pruned)
  return pruned
}

const mcpCustom = loadJson<McpServerConfig[]>(MCP_CUSTOM_KEY, [])

export const useMcpStore = create<McpState>((set) => ({
  custom: mcpCustom,
  connected: loadConnected(mcpCustom),
  status: {},
  errors: {},
  tools: {},
  chatSel: loadJson<Record<string, McpChatSelection>>(MCP_CHATSEL_KEY, {}),
  addServer: (c) => set((s) => {
    const custom = [...s.custom, c]
    saveJson(MCP_CUSTOM_KEY, custom)
    return { custom }
  }),
  removeServer: (name) => set((s) => {
    const custom = s.custom.filter(c => c.name !== name)
    saveJson(MCP_CUSTOM_KEY, custom)
    const connected = { ...s.connected }
    delete connected[name]
    saveJson(MCP_CONNECTED_KEY, connected)
    return { custom, connected }
  }),
  updateServer: (name, patch) => set((s) => {
    const idx = s.custom.findIndex(c => c.name === name)
    if (idx < 0) return {}
    const next = { ...s.custom[idx], ...patch }
    const custom = s.custom.map((c, i) => i === idx ? next : c)
    saveJson(MCP_CUSTOM_KEY, custom)
    const connected = { ...s.connected }
    // a rename must move the persisted "connected" flag with the server
    if (next.name !== name) {
      const wasConnected = connected[name]
      delete connected[name]
      if (wasConnected) connected[next.name] = true
      saveJson(MCP_CONNECTED_KEY, connected)
    }
    return { custom, connected }
  }),
  setConnected: (name, v) => set((s) => {
    const connected = { ...s.connected, [name]: v }
    saveJson(MCP_CONNECTED_KEY, connected)
    return { connected }
  }),
  setStatus: (name, status) => set((s) => ({ status: { ...s.status, [name]: status } })),
  setError: (name, e) => set((s) => {
    const errors = { ...s.errors }
    if (e) errors[name] = e
    else delete errors[name]
    return { errors }
  }),
  setTools: (name, tools) => set((s) => ({ tools: { ...s.tools, [name]: tools } })),
  setChatSel: (name, sel) => set((s) => {
    const chatSel = { ...s.chatSel, [name]: sel }
    saveJson(MCP_CHATSEL_KEY, chatSel)
    return { chatSel }
  })
}))

// ─── Claude nativo (subscription CLI / API Anthropic) ────────────────────────
export const CLAUDE_MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { id: 'claude-fable-5', label: 'Fable 5' }
]
export const CLAUDE_EFFORTS: ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
// only meaningful on the subscription backend, where Claude drives real tools
export const CLAUDE_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

const CLAUDE_KEY = 'damnedide_claude'

interface ClaudeState {
  backend: ClaudeBackend
  model: string
  effort: ClaudeEffort
  permissionMode: string
  // chatKey -> CLI session id: resuming keeps the transcript on the CLI side so
  // each turn only sends the new message instead of the whole history
  sessions: Record<string, string>
  setConfig: (patch: Partial<Pick<ClaudeState, 'backend' | 'model' | 'effort' | 'permissionMode'>>) => void
  setSession: (chatKey: string, sessionId: string) => void
  clearSession: (chatKey: string) => void
}

type ClaudePersisted = Pick<ClaudeState, 'backend' | 'model' | 'effort' | 'permissionMode' | 'sessions'>

const CLAUDE_DEFAULTS: ClaudePersisted = {
  backend: 'subscription',
  model: 'claude-opus-5',
  effort: 'high',
  permissionMode: 'default',
  sessions: {}
}

export const useClaudeStore = create<ClaudeState>((set) => {
  const persist = (s: ClaudePersisted) => saveJson(CLAUDE_KEY, s)
  const pick = (s: ClaudeState): ClaudePersisted => ({
    backend: s.backend, model: s.model, effort: s.effort, permissionMode: s.permissionMode, sessions: s.sessions
  })
  return {
    ...CLAUDE_DEFAULTS,
    ...loadJson<Partial<ClaudePersisted>>(CLAUDE_KEY, {}),
    setConfig: (patch) => set((s) => {
      const next = { ...pick(s), ...patch }
      persist(next)
      return patch
    }),
    setSession: (chatKey, sessionId) => set((s) => {
      const sessions = { ...s.sessions, [chatKey]: sessionId }
      persist({ ...pick(s), sessions })
      return { sessions }
    }),
    clearSession: (chatKey) => set((s) => {
      const sessions = { ...s.sessions }
      delete sessions[chatKey]
      persist({ ...pick(s), sessions })
      return { sessions }
    })
  }
})

// ─── Agentic chat: IDE-level rules + concurrent multi-provider sessions ───────
export interface AiChatMessage {
  role: 'user' | 'assistant'
  text: string
}

const AI_RULES_KEY = 'damnedide_ai_rules'

// {worktree} is replaced at send time with the currently selected worktree path.
const DEFAULT_AI_RULES = ["L'area di lavoro da considerare è il worktree: {worktree}"]

interface AiRulesState {
  rules: string[]
  addRule: (r: string) => void
  removeRule: (index: number) => void
}

export const useAiChatStore = create<AiRulesState>((set) => ({
  rules: loadJson<string[]>(AI_RULES_KEY, DEFAULT_AI_RULES),
  addRule: (r) => set((s) => {
    const rules = [...s.rules, r]
    saveJson(AI_RULES_KEY, rules)
    return { rules }
  }),
  removeRule: (index) => set((s) => {
    const rules = s.rules.filter((_, i) => i !== index)
    saveJson(AI_RULES_KEY, rules)
    return { rules }
  })
}))

// A chat session: an independent conversation pinned to a provider (and usually
// a worktree). Several sessions can be open — and stream — at the same time.
export interface AgentSession {
  id: string
  title: string
  provider: AgentProviderId
  worktree: string | null
  model: string
  effort: string
  permissionMode: string
  backend: ClaudeBackend
  messages: AiChatMessage[]
  // provider-side session id, used to resume (claude --resume, opencode --session…)
  sessionId?: string
}

const AGENT_SESSIONS_KEY = 'damnedide_agent_sessions'
const AGENT_ACTIVE_KEY = 'damnedide_agent_active'

interface AgentChatState {
  sessions: AgentSession[]
  activeId: string | null
  createSession: (partial?: Partial<Omit<AgentSession, 'id' | 'messages'>>) => string
  closeSession: (id: string) => void
  setActive: (id: string | null) => void
  updateSession: (id: string, patch: Partial<AgentSession>) => void
  setMessages: (id: string, msgs: AiChatMessage[]) => void
  clearMessages: (id: string) => void
}

function loadAgentSessions(): AgentSession[] {
  const list = loadJson<AgentSession[]>(AGENT_SESSIONS_KEY, [])
  return Array.isArray(list) ? list.filter(s => s && typeof s.id === 'string') : []
}

export const useAgentChatStore = create<AgentChatState>((set) => {
  const persist = (s: AgentChatState) => saveJson(AGENT_SESSIONS_KEY, s.sessions)
  const saveActive = (id: string | null) => saveJson(AGENT_ACTIVE_KEY, id)
  const makeId = () => `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  return {
    sessions: loadAgentSessions(),
    activeId: loadJson<string | null>(AGENT_ACTIVE_KEY, null),
    createSession: (partial) => {
      const id = makeId()
      const session: AgentSession = {
        id,
        title: partial?.title || 'new chat',
        provider: partial?.provider || 'claude',
        worktree: partial?.worktree ?? null,
        model: partial?.model || '',
        effort: partial?.effort || '',
        permissionMode: partial?.permissionMode || 'default',
        backend: partial?.backend || 'subscription',
        messages: []
      }
      set((s) => {
        const next = { sessions: [...s.sessions, session], activeId: id }
        persist(next as AgentChatState)
        saveActive(id)
        return next
      })
      return id
    },
    closeSession: (id) => set((s) => {
      const sessions = s.sessions.filter(x => x.id !== id)
      const activeId = s.activeId === id ? (sessions[sessions.length - 1]?.id ?? null) : s.activeId
      persist({ sessions } as AgentChatState)
      saveActive(activeId)
      return { sessions, activeId }
    }),
    setActive: (id) => {
      saveActive(id)
      set({ activeId: id })
    },
    updateSession: (id, patch) => set((s) => {
      const sessions = s.sessions.map(x => x.id === id ? { ...x, ...patch } : x)
      persist({ sessions } as AgentChatState)
      return { sessions }
    }),
    setMessages: (id, msgs) => set((s) => {
      const sessions = s.sessions.map(x => x.id === id ? { ...x, messages: msgs } : x)
      persist({ sessions } as AgentChatState)
      return { sessions }
    }),
    clearMessages: (id) => set((s) => {
      const sessions = s.sessions.map(x => x.id === id ? { ...x, messages: [], sessionId: undefined } : x)
      persist({ sessions } as AgentChatState)
      return { sessions }
    })
  }
})

// ─── Configured AI agents (which providers the IDE offers) ────────────────────
export const ALL_AGENT_PROVIDERS: AgentProviderId[] = ['claude', 'opencode', 'codex', 'cursor']

const AGENT_CONFIG_KEY = 'damnedide_agent_providers'

interface AgentConfigState {
  configured: AgentProviderId[]
  addAgent: (id: AgentProviderId) => void
  removeAgent: (id: AgentProviderId) => void
}

function loadConfiguredAgents(): AgentProviderId[] {
  const stored = loadJson<AgentProviderId[] | null>(AGENT_CONFIG_KEY, null)
  // first run: every supported provider is available in the chat
  if (!Array.isArray(stored)) return [...ALL_AGENT_PROVIDERS]
  return stored.filter((id) => (ALL_AGENT_PROVIDERS as string[]).includes(id))
}

export const useAgentConfigStore = create<AgentConfigState>((set) => ({
  configured: loadConfiguredAgents(),
  addAgent: (id) => set((s) => {
    if (s.configured.includes(id)) return {}
    const configured = [...s.configured, id]
    saveJson(AGENT_CONFIG_KEY, configured)
    return { configured }
  }),
  removeAgent: (id) => set((s) => {
    const configured = s.configured.filter((x) => x !== id)
    saveJson(AGENT_CONFIG_KEY, configured)
    return { configured }
  })
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
