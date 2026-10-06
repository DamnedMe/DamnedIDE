import { EventEmitter } from 'events'
import { readFileSync } from 'fs'
import QRCode from 'qrcode'
import type { DeviceInfo, PairingPayload, PairingStart, RemoteSqlConnection, RemoteScope, WorkspaceSnapshot } from '../../../src/shared/remote/protocol'
import { DEEP_LINK_SCHEME, PROTOCOL_VERSION, REMOTE_PRODUCT_NAME, toBase64Url } from '../../../src/shared/remote/protocol'
import { GitService } from '../git/git.service'
import { WorktreeService } from '../git/worktree.service'
import { DiffService } from '../git/diff.service'
import { SqlService } from '../sql/sql.service'
import { DeviceRegistry } from './auth/device-registry'
import { PairingService } from './auth/pairing'
import { WorkspaceState } from './workspace-state'
import { RemoteWsServer, type PendingPairing, type WsServerOptions } from './transports/ws-server'
import { getTailscaleStatus, getLanIp, type TailscaleStatus } from './tailscale'
import { onFsChanged } from '../watch/watch.service'

/** Static GitHub Pages landing that offers the APK and the deep link. */
const LANDING_BASE = 'https://damnedme.github.io/DamnedCloud/pair/'
const DEFAULT_PORT = 8765

export interface RemoteStatus {
  enabled: boolean
  listening: boolean
  host: string | null
  port: number
  tls: boolean
  deviceCount: number
  tailscale: TailscaleStatus
  warning?: string
}

export interface RemoteServiceDeps {
  userDataDir: string
  appVersion: string
  platform: string
  git: GitService
  worktree: WorktreeService
  diff: DiffService
  sql: SqlService
}

interface ActiveConnection {
  host: string
  port: number
  tls: boolean
}

/**
 * Orchestrates the DamnedCloud remote bridge: device registry, pairing, the
 * WebSocket transport and the workspace mirror. Emits events the main process
 * forwards to the renderer (`pairing-request`, `pairing-resolved`, `log`, …).
 */
export class RemoteService extends EventEmitter {
  readonly workspace = new WorkspaceState()
  private readonly registry: DeviceRegistry
  private readonly pairing = new PairingService()
  private server: RemoteWsServer | null = null
  private connection: ActiveConnection | null = null
  private sqlConnections: RemoteSqlConnection[] = []
  private warning: string | undefined
  private unsubscribeFs: (() => void) | null = null

  constructor(private deps: RemoteServiceDeps) {
    super()
    this.registry = new DeviceRegistry(deps.userDataDir)
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async start(options: { port?: number; host?: string; tls?: { certPath: string; keyPath: string } } = {}): Promise<RemoteStatus> {
    await this.stop()
    const port = options.port || DEFAULT_PORT
    const net = await this.pickNetwork()
    const host = options.host || net.bind
    const advertised = options.host || net.advertise
    let tls: WsServerOptions['tls']
    if (options.tls) {
      tls = { cert: readFileSync(options.tls.certPath, 'utf-8'), key: readFileSync(options.tls.keyPath, 'utf-8') }
    }

    this.server = new RemoteWsServer(
      this.registry,
      this.pairing,
      this.workspace,
      {
        git: this.deps.git,
        worktree: this.deps.worktree,
        diff: this.deps.diff,
        sql: this.deps.sql,
        appVersion: this.deps.appVersion,
        platform: this.deps.platform,
        getSqlConnections: () => this.sqlConnections
      },
      {
        onPairingRequest: (request) => this.emit('pairing-request', request),
        onPairingResolved: (id, accepted) => this.emit('pairing-resolved', { id, accepted }),
        onDeviceChanged: () => this.emit('device-changed'),
        log: (message) => this.emit('log', message)
      }
    )

    await this.server.start({ host, port, tls })
    this.connection = { host: advertised, port, tls: !!tls }

    if (!this.unsubscribeFs) {
      this.unsubscribeFs = onFsChanged((root) => this.broadcast('fs.changed', { root }))
    }
    if (!this.unsubscribeWorkspace) {
      this.unsubscribeWorkspace = this.workspace.onChanged((snapshot) => this.broadcast('workspace.changed', snapshot))
    }

    return this.status()
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.stop()
      this.server = null
    }
    this.connection = null
    return
  }

  get isListening(): boolean {
    return !!this.server?.listening
  }

  async status(): Promise<RemoteStatus> {
    const tailscale = await getTailscaleStatus()
    return {
      enabled: this.isListening,
      listening: this.isListening,
      host: this.connection?.host ?? null,
      port: this.connection?.port ?? DEFAULT_PORT,
      tls: this.connection?.tls ?? false,
      deviceCount: this.registry.count(),
      tailscale,
      warning: this.warning
    }
  }

  // ─── Pairing ──────────────────────────────────────────────────────────────

  async beginPairing(): Promise<PairingStart> {
    if (!this.connection) throw new Error('Accesso remoto non attivo')
    const { token, expiresAt } = this.pairing.begin()
    const payload: PairingPayload = {
      v: PROTOCOL_VERSION,
      host: this.connection.host,
      port: this.connection.port,
      tls: this.connection.tls,
      token,
      name: REMOTE_PRODUCT_NAME,
      ide: `DamnedIDE ${this.deps.appVersion}`
    }
    const encoded = toBase64Url(JSON.stringify(payload))
    const url = `${LANDING_BASE}#${encoded}`
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 })
    return { payload, url, qrDataUrl, expiresAt }
  }

  resolvePairing(id: string, accepted: boolean): void {
    this.server?.resolvePairing(id, accepted)
  }

  listPending(): PendingPairing[] {
    return this.server?.listPending() ?? []
  }

  /** Deep link the landing page hands to the app (kept for parity/tests). */
  deepLink(payload: PairingPayload): string {
    return `${DEEP_LINK_SCHEME}://pair?d=${toBase64Url(JSON.stringify(payload))}`
  }

  // ─── Devices ──────────────────────────────────────────────────────────────

  listDevices(): DeviceInfo[] {
    return this.registry.list()
  }

  revokeDevice(id: string): void {
    this.registry.revoke(id)
    this.emit('device-changed')
  }

  revokeAll(): void {
    this.registry.revokeAll()
    this.emit('device-changed')
  }

  updateScopes(id: string, scopes: RemoteScope[]): DeviceInfo | null {
    const device = this.registry.updateScopes(id, scopes)
    this.emit('device-changed')
    return device
  }

  // ─── Mirror / data ────────────────────────────────────────────────────────

  setWorkspace(patch: Partial<Omit<WorkspaceSnapshot, 'revision'>>): WorkspaceSnapshot {
    return this.workspace.update(patch)
  }

  setApplyHandler(handler: Parameters<WorkspaceState['setApplyHandler']>[0]): void {
    this.workspace.setApplyHandler(handler)
  }

  setSqlConnections(connections: RemoteSqlConnection[]): void {
    this.sqlConnections = connections
  }

  broadcast(topic: Parameters<RemoteWsServer['broadcast']>[0], data: unknown): void {
    this.server?.broadcast(topic, data)
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async pickNetwork(): Promise<{ bind: string; advertise: string }> {
    const ts = await getTailscaleStatus()
    if (ts.running && ts.ipv4) {
      this.warning = undefined
      // Bind to the concrete tailnet IP (stable), advertise the MagicDNS name
      // (survives IP changes on the phone side).
      return { bind: ts.ipv4, advertise: ts.dnsName || ts.ipv4 }
    }
    const lan = getLanIp()
    if (lan) {
      this.warning = 'Tailscale non rilevato: il bridge è raggiungibile solo sulla rete locale.'
      return { bind: lan, advertise: lan }
    }
    this.warning = 'Nessuna interfaccia Tailscale/LAN: il bridge è raggiungibile solo in locale.'
    return { bind: '127.0.0.1', advertise: '127.0.0.1' }
  }

  private unsubscribeWorkspace: (() => void) | null = null

  dispose(): void {
    this.unsubscribeFs?.()
    this.unsubscribeFs = null
    this.unsubscribeWorkspace?.()
    this.unsubscribeWorkspace = null
  }
}
