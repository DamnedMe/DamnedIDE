// ─────────────────────────────────────────────────────────────────────────────
// DamnedCloud remote protocol
//
// This file is the single source of truth for the wire contract between the
// desktop IDE (Electron main) and the DamnedCloud mobile app. It is intentionally
// free of any Node/DOM API so it can be imported by the main process, the
// renderer and the mobile app.
//
// The mobile app keeps a copy of this file (see DamnedCloud/src/shared/remote)
// and the two must be kept in sync. Bump PROTOCOL_VERSION on any breaking change.
// ─────────────────────────────────────────────────────────────────────────────

export const PROTOCOL_VERSION = 1

export const PRODUCT_NAME = 'DamnedIDE'
export const REMOTE_PRODUCT_NAME = 'DamnedCloud'

/** Custom URI scheme used by the mobile app for pairing deep links. */
export const DEEP_LINK_SCHEME = 'damnedcloud'

// ─── Capabilities granted to a paired device ────────────────────────────────

export type RemoteScope =
  | 'view' // read worktrees, files, diffs, sql metadata
  | 'edit' // write files / save editor buffers
  | 'git' // stage, commit, push, pull, discard…
  | 'sql' // run queries
  | 'sqlDestructive' // backup/restore/data-tier and unfiltered mutations
  | 'terminal' // terminal + running processes (P2)

export const ALL_SCOPES: RemoteScope[] = ['view', 'edit', 'git', 'sql', 'sqlDestructive', 'terminal']

/** Scopes enabled by default for a freshly paired device. */
export const DEFAULT_SCOPES: RemoteScope[] = ['view']

export const SCOPE_LABELS: Record<RemoteScope, string> = {
  view: 'Solo lettura',
  edit: 'Modifica file',
  git: 'Operazioni Git',
  sql: 'Query SQL',
  sqlDestructive: 'SQL distruttivo (backup/restore/mutazioni)',
  terminal: 'Terminale e processi'
}

// ─── Devices ────────────────────────────────────────────────────────────────

export interface DeviceInfo {
  id: string
  name: string
  platform: string
  scopes: RemoteScope[]
  createdAt: number
  lastSeen: number | null
}

// ─── Workspace snapshot (mirror of the desktop UI) ───────────────────────────

export interface EditorNavState {
  rootPath: string
  filePath: string
  line: number
  previewMd?: boolean
}

export interface WorkspaceSnapshot {
  /** Monotonic revision, incremented by the desktop on every change. */
  revision: number
  repoPath: string | null
  selectedWorktree: string | null
  activePanel: string
  editorNav: EditorNavState | null
  /** Repositories last opened on the desktop, newest first; absent on bridges up to IDE 0.1.2. */
  recentRepos?: string[]
  /** Desktop theme, so the app looks like the IDE; absent on bridges up to IDE 0.1.2. */
  theme?: RemoteTheme
}

export interface RemoteTheme {
  mode: 'dark' | 'light'
  /** Settings › Theme › primary color (#rrggbb). */
  accent: string
}

/**
 * Sanitised SQL connection metadata pushed by the renderer. Passwords and other
 * credentials never leave the desktop; remote clients can only use connections
 * that are already open on the desktop.
 */
export interface RemoteSqlConnection {
  id: string
  label: string
  server: string
  database?: string
  isConnected: boolean
}

// ─── Release (Azure DevOps promotion, as the desktop Release panel) ─────────
// Wire shapes of src/shared/adoPromotion.ts and src/shared/adoChain.ts, repeated here so the app's
// copy of this file stays import-free. Bridges up to IDE 0.1.2 answer `unknown_command`.

export type ReleaseStage = 'dev-qa' | 'qa-prod' | 'dev-qa-prod'
export type ReleaseScope = 'be' | 'fe' | 'both'
export type ReleaseSide = 'BE' | 'FE'
export type ReleaseRole = 'dev' | 'qa' | 'prod'

export interface ReleasePr {
  id: number
  url: string
}

export interface ReleaseWorkItem {
  id: number
  title: string
  type: string
  state: string
}

export interface ReleaseCommit {
  commitId: string
  message: string
  author: string
}

/** What one repository would promote, read from Azure DevOps when asked (release.preview). */
export interface ReleaseRepoPreview {
  side: ReleaseSide
  repo: string
  /** remote branches, for the pickers; empty when not read */
  branches: string[]
  /** null: not found on the remote (pick it: release.setConfig) */
  source: string | null
  target: string | null
  /** develop → qa → prod only */
  prod?: string | null
  commits: ReleaseCommit[]
  workItems: ReleaseWorkItem[]
  /** an active PR source → target already exists: no new one is created */
  existing: ReleasePr | null
  /** develop → qa → prod, nothing for qa: commits qa → prod (the chain starts there) */
  prodCommits?: number
  /** develop → qa → prod, nothing for qa: the qa → prod PR already open */
  prodExisting?: ReleasePr | null
  /** develop → qa → prod: a chain of the project already follows this repository */
  chainRunning?: boolean
  warning?: string
  error?: string
}

export type ReleaseChainStatus = 'waiting-qa' | 'creating-prod' | 'waiting-prod' | 'done' | 'failed' | 'cancelled'

export interface ReleaseChainItem {
  side: ReleaseSide
  repo: string
  branches: { dev: string; qa: string; prod: string }
  qaPr?: ReleasePr
  qaNoAutoComplete?: boolean
  prodPr?: ReleasePr
  prodReused?: boolean
  prodNoAutoComplete?: boolean
  prodDone?: boolean
  status: ReleaseChainStatus
  error?: string
  lastError?: string
  note?: string
  updatedAt: number
}

export interface ReleaseChainView {
  id: string
  organization: string
  project: string
  autoComplete: boolean
  createdAt: number
  items: ReleaseChainItem[]
}

/** release.state: the open repository's Azure DevOps project and its release settings. */
export interface ReleaseState {
  /** why the release cannot run here (no repository, no connection, folder repository not clear) */
  unavailable?: string
  organization: string
  project: string
  /** the open folder's Azure DevOps repository (the default BE) */
  folderRepo: string
  /** BE / FE repositories (saved per project, '' = none) */
  be: string
  fe: string
  /** the stage the desktop panel last used */
  stage: ReleaseStage
  /** the connection's repositories, for the BE / FE pickers */
  repos: string[]
  reposError?: string
  /** the project's chains, newest first */
  chains: ReleaseChainView[]
}

/** release.create / release.chainStart: what happened to each repository. */
export interface ReleaseCreated {
  side: ReleaseSide
  repo: string
  /** false: Azure DevOps refused the PR (branch policies, PAT permissions) */
  ok: boolean
  pr?: ReleasePr
  mode?: 'autocomplete' | 'completed' | 'open'
  /** auto-complete was asked for and Azure DevOps did not take it (the PR stays open) */
  notArmed?: boolean
}

export interface ReleaseRunInput {
  repoPath?: string
  /** release.create: dev-qa or qa-prod (qa-prod asks to confirm) */
  stage?: ReleaseStage
  scope: ReleaseScope
  autoComplete: boolean
  /** unticked work items, as `${side}:${id}` */
  excluded?: string[]
  confirm?: string
}

// ─── Pairing ────────────────────────────────────────────────────────────────

/**
 * Payload encoded into the QR code. The QR points at the static landing page
 * (https://<user>.github.io/DamnedCloud/pair/#<base64url(json)>); the landing
 * turns it into a `damnedcloud://pair?...` deep link and offers the APK.
 */
export interface PairingPayload {
  v: number
  /** WebSocket host reachable over the tailnet (MagicDNS name or IP). */
  host: string
  port: number
  /** true => wss://, false => ws:// (still encrypted inside WireGuard). */
  tls: boolean
  /** One-time pairing token (short TTL, single use). */
  token: string
  /** Human readable desktop name shown during confirmation. */
  name: string
  /** IDE product + version for compatibility checks. */
  ide: string
}

export interface PairingStart {
  payload: PairingPayload
  /** Encoded deep-link / landing URL for QR generation. */
  url: string
  /** data:image/png;base64 QR of `url`. */
  qrDataUrl: string
  expiresAt: number
}

export interface PairingProbe {
  name: string
  ide: string
  platform: string
}

/** Result of completing a pairing: the long-lived device token. */
export interface PairingResult {
  device: DeviceInfo
  token: string
}

/**
 * `pairing.pending` event data, sent to the socket waiting on `pair` once the desktop is asked
 * to confirm: the same code the desktop shows. Bridges up to IDE 0.1.0 never send it.
 */
export interface PairingPendingEvent {
  code: string
}

// ─── Confirmation challenges (destructive actions) ──────────────────────────

export interface ConfirmationChallenge {
  id: string
  /** Command that requested confirmation. */
  command: string
  /** Human readable summary of what will happen. */
  summary: string
  /** Extra details (e.g. the generated SQL). */
  details?: string
  /** true when the action is considered destructive/high risk. */
  destructive: boolean
  createdAt: number
  expiresAt: number
}

// ─── Envelope ───────────────────────────────────────────────────────────────

export interface RemoteError {
  code: string
  message: string
  /** When set, the client must ask the user to confirm, then retry with the id. */
  challenge?: ConfirmationChallenge
}

export interface ReqEnvelope {
  v: number
  id: string
  kind: 'req'
  cmd: string
  args?: unknown
}

export interface ResOkEnvelope {
  v: number
  id: string
  kind: 'res'
  ok: true
  data?: unknown
}

export interface ResErrEnvelope {
  v: number
  id: string
  kind: 'res'
  ok: false
  error: RemoteError
}

export interface EvtEnvelope {
  v: number
  kind: 'evt'
  topic: RemoteTopic
  data: unknown
}

export type Envelope = ReqEnvelope | ResOkEnvelope | ResErrEnvelope | EvtEnvelope

export type RemoteTopic =
  | 'workspace.changed'
  | 'fs.changed'
  | 'git.changed'
  | 'sql.execution'
  | 'device.changed' // data: DeviceInfo, pushed to that device's sockets when its scopes change
  | 'pairing.pending' // data: PairingPendingEvent
  | 'release.changed' // data: null; release settings or chains changed (read release.state again)

/**
 * Changes a remote device asks the desktop UI to apply. Sent main → renderer so
 * the desktop reflects what the phone is doing (mirror), keeping the renderer as
 * the single source of truth for UI stores.
 */
export type RemoteApply =
  | { type: 'workspace.setRepo'; repoPath: string }
  | { type: 'workspace.openWorktree'; path: string }
  | { type: 'editor.open'; rootPath: string; filePath: string; line?: number; previewMd?: boolean }
  | { type: 'panel'; panel: string }

// ─── Handshake ──────────────────────────────────────────────────────────────

export interface HelloPayload {
  protocolVersion: number
  ide: string
  ideVersion: string
  name: string
}

export interface AuthRequest {
  token: string
  platform?: string
}

// ─── Command map ────────────────────────────────────────────────────────────
// Args/result typing for the commands the mobile app uses. Commands not listed
// here still work (args/result are `unknown`) but client-side typing is weaker.

export interface RemoteCommandMap {
  'system.ping': { args: undefined; result: { time: number } }
  'system.info': {
    args: undefined
    result: {
      ide: string
      ideVersion: string
      protocolVersion: number
      platform: string
      repoPath: string | null
    }
  }

  'workspace.state': { args: undefined; result: WorkspaceSnapshot }
  'workspace.setRepo': { args: { repoPath: string }; result: WorkspaceSnapshot }
  'workspace.openWorktree': { args: { path: string }; result: WorkspaceSnapshot }

  // `repoPath` (worktree.* and git.*): the open repository, one of its worktrees or a folder inside
  // them, `outside_workspace` otherwise; omitted = the open repository
  'worktree.list': { args: { repoPath?: string }; result: unknown }
  'worktree.add': { args: { repoPath: string; branch: string; path: string; base?: string }; result: unknown }
  // checked like the desktop cleanup: uncommitted changes, unpushed commits, the main checkout, bare and
  // nested worktrees answer { ok: false, skipped: true, error } with nothing touched
  'worktree.remove': { args: { repoPath: string; worktreePath: string; confirm?: string }; result: unknown }
  'worktree.promote': { args: { repoPath: string; worktreePath: string }; result: unknown }

  'git.status': { args: { repoPath?: string }; result: unknown }
  'git.porcelain': { args: { repoPath?: string }; result: unknown }
  // `file`: relative to the repository (as git.porcelain lists it) or absolute
  'git.diff': { args: { repoPath: string; file: string; staged?: boolean }; result: unknown }
  // a `ref` starting with '-' is refused with `invalid_args`
  'git.file': { args: { repoPath: string; file: string; ref?: string }; result: { content: string } }
  'git.stage': { args: { repoPath: string; files: string[] }; result: unknown }
  'git.unstage': { args: { repoPath: string; files: string[] }; result: unknown }
  'git.commit': { args: { repoPath: string; message: string }; result: unknown }
  'git.pull': { args: { repoPath: string }; result: unknown }
  'git.push': { args: { repoPath: string }; result: unknown }
  'git.discard': { args: { repoPath: string; file: string; staged?: boolean; untracked?: boolean; confirm?: string }; result: unknown }

  'fs.tree': { args: { root: string }; result: unknown }
  'fs.read': { args: { file: string }; result: { content: string } }
  'fs.write': { args: { file: string; content: string }; result: unknown }
  'fs.search': { args: { root: string; query: string; maxResults?: number; exts?: string[] }; result: unknown }
  'fs.list': { args: { root: string; maxResults?: number }; result: string[] }

  'editor.open': { args: { rootPath: string; filePath: string; line?: number; previewMd?: boolean }; result: WorkspaceSnapshot }
  'editor.save': { args: { file: string; content: string }; result: unknown }

  'sql.connections': { args: undefined; result: unknown }
  'sql.databases': { args: { connectionId: string }; result: unknown }
  'sql.tables': { args: { connectionId: string; database: string }; result: unknown }
  'sql.columns': { args: { connectionId: string; database: string; table: string }; result: unknown }
  // `queryId` (remote_<1-64 of [A-Za-z0-9_-]>): chosen by the app so sql.cancel can reach the query;
  // generated by the bridge when missing or malformed (always, on bridges up to IDE 0.1.0)
  'sql.query': { args: { connectionId: string; query: string; database?: string; maxRows?: number; queryId?: string }; result: unknown }
  'sql.cancel': { args: { queryId: string }; result: unknown }
  'sql.objectDefinition': { args: { connectionId: string; database: string; objectName: string }; result: unknown }

  // Release (Azure DevOps): reads are "view", the rest "git"; `repoPath` as for git.*
  'release.state': { args: { repoPath?: string }; result: ReleaseState }
  'release.preview': { args: { repoPath?: string; stage: ReleaseStage; scope: ReleaseScope }; result: ReleaseRepoPreview[] }
  // one PR per repository with new commits and no active promotion PR; qa-prod asks to confirm
  'release.create': { args: ReleaseRunInput & { stage: 'dev-qa' | 'qa-prod' }; result: ReleaseCreated[] }
  // develop → qa → prod, always confirmed: the develop → qa PRs now, each qa → prod one by the desktop when it is completed
  'release.chainStart': { args: ReleaseRunInput; result: { created: ReleaseCreated[]; chain: ReleaseChainView | null } }
  'release.chainCancel': { args: { id: string }; result: unknown }
  'release.chainRemove': { args: { id: string }; result: unknown }
  // saved per project, as from the desktop panel: beRepo / feRepo ('' = none), or one branch override
  'release.setConfig': {
    args: { repoPath?: string; beRepo?: string; feRepo?: string; branch?: { repo: string; role: ReleaseRole; name: string } }
    result: ReleaseState
  }

  /**
   * The calling device revokes itself ("disassocia"); `unknown_command` on bridges up to IDE 0.1.0.
   * Every socket of the device is then closed with 4401, the caller's right after this reply.
   */
  'device.forget': { args: undefined; result: { ok: boolean } }
  'device.list': { args: undefined; result: DeviceInfo[] }
  'device.revoke': { args: { id: string }; result: unknown }
  'device.scopes': { args: { id: string; scopes: RemoteScope[] }; result: DeviceInfo }
}

export type RemoteCommand = keyof RemoteCommandMap
export type RemoteCommandArgs<K extends RemoteCommand> = RemoteCommandMap[K]['args']
export type RemoteCommandResult<K extends RemoteCommand> = RemoteCommandMap[K]['result']

// ─── Helpers ────────────────────────────────────────────────────────────────

/** base64url (no padding) encode, usable in both Node and the browser. */
export function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.v !== PROTOCOL_VERSION) return false
  if (v.kind === 'req') return typeof v.id === 'string' && typeof v.cmd === 'string'
  if (v.kind === 'res') return typeof v.id === 'string' && typeof v.ok === 'boolean'
  if (v.kind === 'evt') return typeof v.topic === 'string'
  return false
}
