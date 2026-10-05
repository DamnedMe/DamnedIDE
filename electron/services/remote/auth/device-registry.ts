import { randomBytes, createHash } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import type { DeviceInfo, RemoteScope } from '../../../../src/shared/remote/protocol'
import { DEFAULT_SCOPES } from '../../../../src/shared/remote/protocol'

interface StoredDevice extends DeviceInfo {
  /** sha256(secret + token), never the token itself. */
  tokenHash: string
}

interface RegistryFile {
  secret: string
  devices: StoredDevice[]
}

const TOKEN_BYTES = 32

function hashToken(secret: string, token: string): string {
  return createHash('sha256').update(secret).update(token).digest('hex')
}

/**
 * Persistent registry of paired devices. Tokens are stored only as salted
 * hashes; the plaintext token exists on the phone and in the pairing response.
 */
export class DeviceRegistry {
  private file: string
  private data: RegistryFile

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'damnedcloud-devices.json')
    this.data = this.load()
  }

  private load(): RegistryFile {
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf-8')) as RegistryFile
        if (parsed && Array.isArray(parsed.devices) && typeof parsed.secret === 'string') return parsed
      }
    } catch {
      /* corrupted file → start fresh */
    }
    return { secret: randomBytes(32).toString('hex'), devices: [] }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[remote] failed to persist devices:', (err as Error)?.message)
    }
  }

  list(): DeviceInfo[] {
    return this.data.devices.map(({ tokenHash: _tokenHash, ...d }) => d)
  }

  count(): number {
    return this.data.devices.length
  }

  /** Register a new device and return its plaintext token (only time it exists). */
  add(input: { name: string; platform: string; scopes?: RemoteScope[] }): { device: DeviceInfo; token: string } {
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    const device: StoredDevice = {
      id: randomBytes(8).toString('hex'),
      name: input.name || 'Dispositivo',
      platform: input.platform || 'unknown',
      scopes: input.scopes && input.scopes.length ? input.scopes : [...DEFAULT_SCOPES],
      createdAt: Date.now(),
      lastSeen: null,
      tokenHash: hashToken(this.data.secret, token)
    }
    this.data.devices.push(device)
    this.save()
    const { tokenHash: _tokenHash, ...info } = device
    return { device: info, token }
  }

  /** Return the device matching a token, and touch its lastSeen. */
  authenticate(token: string): DeviceInfo | null {
    if (!token) return null
    const hash = hashToken(this.data.secret, token)
    const found = this.data.devices.find((d) => d.tokenHash === hash)
    if (!found) return null
    found.lastSeen = Date.now()
    this.save()
    const { tokenHash: _tokenHash, ...info } = found
    return info
  }

  revoke(id: string): boolean {
    const before = this.data.devices.length
    this.data.devices = this.data.devices.filter((d) => d.id !== id)
    if (this.data.devices.length !== before) {
      this.save()
      return true
    }
    return false
  }

  revokeAll(): void {
    this.data.devices = []
    this.save()
  }

  updateScopes(id: string, scopes: RemoteScope[]): DeviceInfo | null {
    const device = this.data.devices.find((d) => d.id === id)
    if (!device) return null
    device.scopes = scopes
    this.save()
    const { tokenHash: _tokenHash, ...info } = device
    return info
  }
}
