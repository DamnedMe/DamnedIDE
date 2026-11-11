import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'http'
import { createServer as createHttpsServer } from 'https'
import { randomBytes } from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import type { DeviceInfo, Envelope, HelloPayload, PairingPendingEvent, PairingResult, RemoteError, RemoteTopic } from '../../../../src/shared/remote/protocol'
import { PRODUCT_NAME, PROTOCOL_VERSION, REMOTE_PRODUCT_NAME } from '../../../../src/shared/remote/protocol'
import { DeviceRegistry } from '../auth/device-registry'
import { PairingService } from '../auth/pairing'
import { RemoteCommands, RemoteCommandError, type RemoteDeps } from '../commands'
import { WorkspaceState } from '../workspace-state'

interface SocketMeta {
  alive: boolean
  device: DeviceInfo | null
}

export interface PendingPairing {
  id: string
  name: string
  platform: string
  code: string
  requestedAt: number
}

export interface WsServerOptions {
  host: string
  port: number
  tls?: { cert: string; key: string; ca?: string }
}

export interface WsServerHooks {
  onPairingRequest: (request: PendingPairing) => void
  onPairingResolved: (id: string, accepted: boolean) => void
  onDeviceChanged: () => void
  log?: (message: string) => void
}

interface PendingInternal extends PendingPairing {
  token: string
  resolve: (result: PairingResult | null) => void
  socket: WebSocket
}

/**
 * WebSocket transport for the remote protocol. It authenticates devices, routes
 * command requests to {@link RemoteCommands} and fans out events to paired
 * clients. Reachability/crypto is provided by Tailscale (WireGuard); `tls`
 * enables wss:// on top when `tailscale cert` is available.
 */
export class RemoteWsServer {
  private httpServer: HttpServer | null = null
  private wss: WebSocketServer | null = null
  private meta = new WeakMap<WebSocket, SocketMeta>()
  private pending = new Map<string, PendingInternal>()
  private heartbeat: NodeJS.Timeout | null = null
  private readonly commands: RemoteCommands
  private readonly appVersion: string

  constructor(
    private registry: DeviceRegistry,
    private pairing: PairingService,
    workspace: WorkspaceState,
    deps: Omit<RemoteDeps, 'pairing' | 'workspace'>,
    private hooks: WsServerHooks
  ) {
    this.commands = new RemoteCommands({ ...deps, pairing, workspace })
    this.appVersion = deps.appVersion
  }

  start(options: WsServerOptions): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const requestHandler = (_req: IncomingMessage, res: ServerResponse): void => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(`${REMOTE_PRODUCT_NAME} bridge online`)
      }
      this.httpServer = options.tls
        ? createHttpsServer({ cert: options.tls.cert, key: options.tls.key, ca: options.tls.ca }, requestHandler)
        : createServer(requestHandler)

      this.wss = new WebSocketServer({ server: this.httpServer, maxPayload: 16 * 1024 * 1024 })
      this.wss.on('connection', (socket) => this.onConnection(socket))

      this.httpServer.on('error', (err) => reject(err))
      this.httpServer.listen(options.port, options.host, () => {
        this.hooks.log?.(`[remote] bridge in ascolto su ${options.tls ? 'wss' : 'ws'}://${options.host}:${options.port}`)
        resolvePromise()
      })

      this.heartbeat = setInterval(() => this.sweep(), 20000)
    })
  }

  stop(): Promise<void> {
    return new Promise((resolvePromise) => {
      if (this.heartbeat) {
        clearInterval(this.heartbeat)
        this.heartbeat = null
      }
      for (const p of this.pending.values()) p.resolve(null)
      this.pending.clear()
      // ws 8 with an external http server: wss.close() leaves the clients connected and
      // server.close() waits for them, so stop() would hang and the phone keep its access
      for (const socket of [...(this.wss?.clients ?? [])]) socket.terminate()
      try {
        this.wss?.close()
      } catch {
        /* ignore */
      }
      const server = this.httpServer
      this.wss = null
      this.httpServer = null
      if (!server) return resolvePromise()
      server.closeAllConnections?.()
      server.close(() => resolvePromise())
    })
  }

  get listening(): boolean {
    return !!this.wss
  }

  broadcast(topic: RemoteTopic, data: unknown): void {
    const envelope: Envelope = { v: PROTOCOL_VERSION, kind: 'evt', topic, data }
    const message = JSON.stringify(envelope)
    for (const socket of this.wss?.clients ?? []) {
      const meta = this.meta.get(socket)
      if (meta?.device && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(message)
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Called by the desktop UI when the user accepts/rejects a pairing request. */
  resolvePairing(id: string, accepted: boolean): void {
    const request = this.pending.get(id)
    if (!request) return
    this.pending.delete(id)
    if (!accepted || !this.pairing.consume(request.token)) {
      request.resolve(null)
      this.hooks.onPairingResolved(id, false)
      return
    }
    const { device, token } = this.registry.add({ name: request.name, platform: request.platform })
    // the socket that paired is authenticated right away; the app still sends 'auth' with the
    // new token, which older bridges (0.1.0) need
    const meta = this.meta.get(request.socket)
    if (meta) meta.device = device
    request.resolve({ device, token })
    this.hooks.onDeviceChanged()
    this.hooks.onPairingResolved(id, true)
  }

  listPending(): PendingPairing[] {
    return [...this.pending.values()].map(({ id, name, platform, code, requestedAt }) => ({ id, name, platform, code, requestedAt }))
  }

  /** Scopes changed on the desktop: the device's open sockets get the new DeviceInfo now. */
  notifyDevice(device: DeviceInfo): void {
    const envelope: Envelope = { v: PROTOCOL_VERSION, kind: 'evt', topic: 'device.changed', data: device }
    for (const socket of this.wss?.clients ?? []) {
      const meta = this.meta.get(socket)
      if (meta?.device?.id !== device.id) continue
      meta.device = device
      this.send(socket, envelope)
    }
  }

  /** Revoked on the desktop: close the device's sockets (every device's when `id` is omitted). */
  disconnectDevice(id?: string): void {
    for (const socket of [...(this.wss?.clients ?? [])]) {
      const device = this.meta.get(socket)?.device
      if (device && (!id || device.id === id)) this.closeRevoked(socket)
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private onConnection(socket: WebSocket): void {
    this.meta.set(socket, { alive: true, device: null })
    socket.on('pong', () => {
      const meta = this.meta.get(socket)
      if (meta) meta.alive = true
    })
    socket.on('message', (raw) => void this.onMessage(socket, raw.toString()))
    socket.on('error', () => {
      /* ignore; close follows */
    })
    socket.on('close', () => this.meta.delete(socket))
  }

  private async onMessage(socket: WebSocket, raw: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const envelope = parsed as Envelope
    if (!envelope || envelope.kind !== 'req' || typeof envelope.id !== 'string' || typeof envelope.cmd !== 'string') return

    try {
      const data = await this.dispatch(socket, envelope.cmd, envelope.args as Record<string, unknown> | undefined)
      this.send(socket, { v: PROTOCOL_VERSION, id: envelope.id, kind: 'res', ok: true, data })
    } catch (err) {
      const e = err as RemoteCommandError
      const error: RemoteError = e?.challenge
        ? { code: e.code || 'error', message: e.message, challenge: e.challenge as RemoteError['challenge'] }
        : { code: e?.code || 'error', message: e?.message || String(err) }
      this.send(socket, { v: PROTOCOL_VERSION, id: envelope.id, kind: 'res', ok: false, error })
    }
  }

  private async dispatch(socket: WebSocket, cmd: string, args: Record<string, unknown> | undefined): Promise<unknown> {
    const safeArgs = (args ?? {}) as Record<string, unknown>
    switch (cmd) {
      case 'hello':
        return this.buildHello()
      case 'auth': {
        const token = String(safeArgs.token ?? '')
        const device = this.registry.authenticate(token)
        if (!device) throw new RemoteCommandError('unauthorized', 'Token dispositivo non valido')
        const meta = this.meta.get(socket)
        if (meta) meta.device = device
        return device
      }
      case 'pair': {
        const token = String(safeArgs.token ?? '')
        if (!this.pairing.peek(token)) throw new RemoteCommandError('invalid_pairing', 'Codice di associazione non valido o scaduto')
        const result = await this.awaitPairing(socket, token, String(safeArgs.name ?? 'Dispositivo'), String(safeArgs.platform ?? 'unknown'))
        if (!result) throw new RemoteCommandError('pairing_rejected', 'Associazione rifiutata dal desktop')
        return result
      }
    }
    const meta = this.meta.get(socket)
    if (!meta?.device) throw new RemoteCommandError('unauthorized', 'Autenticazione richiesta')
    // read on every command: scopes edited or a revocation on the desktop apply to open sockets too
    const device = this.registry.get(meta.device.id)
    if (!device) {
      meta.device = null
      // after the reply: a close frame sent first would drop the error the app is waiting for
      setImmediate(() => this.closeRevoked(socket))
      throw new RemoteCommandError('unauthorized', 'Dispositivo revocato dal desktop')
    }
    meta.device = device
    if (cmd === 'device.forget') {
      // "disassocia" on the phone: the token stops working everywhere and every socket of the
      // device gets 4401, this one after the reply (as on a revocation caught by a command)
      meta.device = null
      this.registry.revoke(device.id)
      this.disconnectDevice(device.id)
      setImmediate(() => this.closeRevoked(socket))
      this.hooks.onDeviceChanged()
      return { ok: true }
    }
    return this.commands.execute(cmd, safeArgs, device)
  }

  /** 4401 tells the app its token is no longer valid: it drops the session instead of reconnecting. */
  private closeRevoked(socket: WebSocket): void {
    const meta = this.meta.get(socket)
    if (meta) meta.device = null
    try {
      socket.close(4401, 'Dispositivo revocato')
    } catch {
      /* already closing */
    }
  }

  private buildHello(): HelloPayload & { requiresAuth: boolean } {
    return {
      protocolVersion: PROTOCOL_VERSION,
      ide: PRODUCT_NAME,
      ideVersion: this.appVersion,
      name: REMOTE_PRODUCT_NAME,
      requiresAuth: true
    }
  }

  private awaitPairing(socket: WebSocket, token: string, name: string, platform: string): Promise<PairingResult | null> {
    const id = randomBytes(6).toString('hex')
    const code = String(Math.floor(100000 + Math.random() * 900000))
    return new Promise<PairingResult | null>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          this.hooks.onPairingResolved(id, false)
          reject(new RemoteCommandError('pairing_timeout', 'Associazione scaduta'))
        }
      }, 2 * 60 * 1000)
      // a decision (or stop()) clears the timer: it would keep the process alive for 2 minutes
      const resolve = (result: PairingResult | null): void => {
        clearTimeout(timer)
        resolvePromise(result)
      }
      const entry: PendingInternal = { id, token, name, platform, code, requestedAt: Date.now(), resolve, socket }
      this.pending.set(id, entry)
      this.hooks.onPairingRequest({ id, name, platform, code, requestedAt: entry.requestedAt })
      // the phone shows the code the desktop is showing, so the user knows which request to accept
      const pendingEvent: PairingPendingEvent = { code }
      this.send(socket, { v: PROTOCOL_VERSION, kind: 'evt', topic: 'pairing.pending', data: pendingEvent })
    })
  }

  private send(socket: WebSocket, envelope: Envelope): void {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(envelope))
      } catch {
        /* ignore */
      }
    }
  }

  private sweep(): void {
    for (const socket of this.wss?.clients ?? []) {
      const meta = this.meta.get(socket)
      if (!meta) continue
      if (!meta.alive) {
        socket.terminate()
        continue
      }
      meta.alive = false
      try {
        socket.ping()
      } catch {
        /* ignore */
      }
    }
  }
}
