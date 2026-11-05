// Azure DevOps settings of the IDE (connections, repository per folder, release
// BE/FE), kept by the main process in userData and shared by every IDE instance.
// Several instances run at once on one profile: every call reads the files again
// and every change re-reads the file right before writing it, touching only its
// own field, so what another instance saved earlier is kept. A file that exists
// but cannot be parsed is never overwritten: the writers throw instead.
// ponytail: no lock, so two instances writing in the same instant can still drop one change (as in shared-storage.ts)
// PATs are encrypted with the system keystore (SecretBox = Electron safeStorage,
// no plaintext fallback) in a separate file and never leave the main process:
// view() only says whether a connection has a readable one.
import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { sanitizeAdoSettings, sanitizePromotionConfig, migrateLegacyAdo, folderKey } from '../../../src/shared/adoSettings'
import { promotionConfigKey } from '../../../src/shared/adoPromotion'
import type {
  AdoConnectionConfig, AdoConnectionInput, AdoLegacyConnection, AdoRepoRef, AdoSettings, AdoSettingsView
} from '../../../src/shared/adoSettings'
import type { PromotionConfig } from '../../../src/shared/adoPromotion'

export interface SecretBox {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

const NO_ENCRYPTION = 'cifratura di sistema non disponibile: il PAT non può essere salvato in sicurezza'

export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * For the writers: a missing (or empty) file is undefined, one that exists but
 * cannot be read or parsed throws, so a read-modify-write never replaces it
 * with an empty state (every connection, mapping or PAT lost). Also used by
 * promotion-chain.service.ts.
 */
export function readJsonStrict(file: string): unknown {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`${file} non leggibile (${(e as Error).message}): non viene sovrascritto`)
  }
  if (!raw.trim()) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`${file} non leggibile: correggilo o eliminalo, non viene sovrascritto`)
  }
}

/** Tolerant shape of `ado-tokens.json`: { id: base64 }, anything else dropped. */
function tokenMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, data] of Object.entries(raw)) if (typeof data === 'string' && data) out[id] = data
  }
  return out
}

/** Atomic replace (temp file + rename): another instance never reads half a file. */
export function writeJson(file: string, data: unknown, mode?: number): void {
  const json = JSON.stringify(data, null, 2)
  const options = mode === undefined ? undefined : { mode }
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, json, options)
  try {
    renameSync(tmp, file)
  } catch {
    writeFileSync(file, json, options)
    rmSync(tmp, { force: true })
  }
}

export class AdoSettingsStore {
  private readonly dir: string
  private readonly box: SecretBox
  private readonly settingsFile: string
  private readonly tokensFile: string

  constructor(dir: string, box: SecretBox) {
    this.dir = dir
    this.box = box
    this.settingsFile = join(dir, 'ado-settings.json')
    this.tokensFile = join(dir, 'ado-tokens.json')
  }

  /** Fresh from disk on every call (sanitized: a broken file reads as empty). */
  read(): AdoSettings {
    return sanitizeAdoSettings(readJson(this.settingsFile))
  }

  /** tokens[id] = the PAT decrypts (a keystore change leaves an entry that does not: shown as missing). */
  view(): AdoSettingsView {
    const settings = this.read()
    const stored = this.readTokens()
    const tokens: Record<string, boolean> = {}
    for (const c of settings.connections) tokens[c.id] = this.decrypt(stored[c.id]) !== null
    return { ...settings, tokens }
  }

  /** The decrypted PAT of a connection, null when missing or unreadable (keystore changed). */
  token(id: string): string | null {
    return this.decrypt(this.readTokens()[id])
  }

  saveConnection(input: AdoConnectionInput): AdoConnectionConfig {
    const organization = String(input?.organization ?? '').trim()
    const project = String(input?.project ?? '').trim()
    const token = String(input?.token ?? '').trim()
    if (!organization || !project) throw new Error('organization e project sono obbligatori')
    // strict: an unreadable settings file fails here, before the PAT is written
    const current = this.readSettingsStrict()
    const existing = input.id ? current.connections.find(c => c.id === input.id) : undefined
    if (input.id && !existing) throw new Error('connessione non trovata: è stata rimossa nel frattempo')
    const key = promotionConfigKey(organization, project)
    if (current.connections.some(c => c.id !== existing?.id && promotionConfigKey(c.organization, c.project) === key)) {
      throw new Error(`connessione già presente: ${organization}/${project}`)
    }
    if (!existing && !token) throw new Error('il PAT è obbligatorio per una nuova connessione')
    const connection: AdoConnectionConfig = { id: existing?.id ?? randomUUID(), organization, project }
    // the PAT first: a new connection is never saved without it
    if (token) this.writeToken(connection.id, token)
    this.update(s => {
      const i = s.connections.findIndex(c => c.id === connection.id)
      if (i >= 0) s.connections[i] = connection
      else s.connections.push(connection)
      // org/project renamed: the release choices follow the connection
      const oldKey = existing ? promotionConfigKey(existing.organization, existing.project) : key
      if (oldKey !== key && s.release[oldKey] && !s.release[key]) {
        s.release[key] = s.release[oldKey]
        delete s.release[oldKey]
      }
    })
    return connection
  }

  /** Also forgets the folders mapped to it and its PAT (the release choices stay, keyed by org/project). */
  removeConnection(id: string): void {
    // an unreadable tokens file fails before the connection goes
    this.readTokensStrict()
    this.update(s => {
      s.connections = s.connections.filter(c => c.id !== id)
      for (const [key, ref] of Object.entries(s.folders)) {
        if (ref.connectionId === id) delete s.folders[key]
      }
    })
    const tokens = this.readTokensStrict()
    if (id in tokens) {
      delete tokens[id]
      this.writeTokens(tokens)
    }
  }

  /** `key` is a folder path or folderKey; null forgets the mapping. */
  setFolder(key: string, ref: AdoRepoRef | null): void {
    const k = folderKey(String(key ?? ''))
    if (!k) throw new Error('cartella non valida')
    this.update(s => {
      if (!ref) {
        if (!(k in s.folders)) return false
        delete s.folders[k]
        return
      }
      const repository = String(ref.repository ?? '').trim()
      if (!repository) throw new Error('repository non valida')
      if (!s.connections.some(c => c.id === ref.connectionId)) throw new Error('connessione non trovata: è stata rimossa nel frattempo')
      s.folders[k] = { connectionId: ref.connectionId, repository }
    })
  }

  /** `key` = promotionConfigKey(org, project); null (or an empty config) removes it. */
  setRelease(key: string, config: PromotionConfig | null): void {
    const k = String(key ?? '').trim().toLowerCase()
    if (!k) throw new Error('chiave di rilascio non valida')
    const clean = config ? sanitizePromotionConfig(config) : null
    this.update(s => {
      if (clean && Object.keys(clean).length > 0) {
        s.release[k] = clean
      } else {
        if (!(k in s.release)) return false
        delete s.release[k]
      }
    })
  }

  /**
   * One-time import of the old localStorage data (see migrateLegacyAdo). Only
   * when no connection exists yet: another instance may have migrated already.
   * True when something was imported.
   */
  importLegacy(legacy: Record<string, AdoLegacyConnection>, promotion: Record<string, PromotionConfig>): boolean {
    if (this.read().connections.length > 0) return false
    const { settings, tokens } = migrateLegacyAdo(legacy ?? {}, promotion ?? {}, randomUUID)
    if (settings.connections.length === 0 && Object.keys(settings.release).length === 0) return false
    // encrypted up front: without a keystore nothing is written at all
    const encrypted: Record<string, string> = {}
    const plain = Object.entries(tokens)
    if (plain.length > 0) {
      if (!this.box.available()) throw new Error(NO_ENCRYPTION)
      for (const [id, token] of plain) encrypted[id] = this.box.encrypt(token).toString('base64')
      // an unreadable tokens file fails before the connections are claimed
      this.readTokensStrict()
    }
    let imported = false
    this.update(s => {
      if (s.connections.length > 0) return false
      s.connections = settings.connections
      s.folders = settings.folders
      s.release = { ...settings.release, ...s.release }
      imported = true
    })
    // the PATs are written only by the instance that won the settings write: a loser never touches the tokens file
    if (imported && plain.length > 0) this.writeTokens({ ...this.readTokensStrict(), ...encrypted })
    return imported
  }

  /** Read-modify-write of the settings file; `mutate` returning false skips the write. */
  private update(mutate: (s: AdoSettings) => boolean | void): void {
    const settings = this.readSettingsStrict()
    if (mutate(settings) === false) return
    mkdirSync(this.dir, { recursive: true })
    writeJson(this.settingsFile, settings)
  }

  private readSettingsStrict(): AdoSettings {
    return sanitizeAdoSettings(readJsonStrict(this.settingsFile))
  }

  private decrypt(data: string | undefined): string | null {
    if (!data) return null
    try {
      return this.box.decrypt(Buffer.from(data, 'base64')) || null
    } catch {
      return null
    }
  }

  private readTokens(): Record<string, string> {
    return tokenMap(readJson(this.tokensFile))
  }

  /** For the token writers: an unparseable tokens file throws instead of losing every other PAT. */
  private readTokensStrict(): Record<string, string> {
    return tokenMap(readJsonStrict(this.tokensFile))
  }

  private writeToken(id: string, token: string): void {
    if (!this.box.available()) throw new Error(NO_ENCRYPTION)
    const encrypted = this.box.encrypt(token).toString('base64')
    const tokens = this.readTokensStrict()
    tokens[id] = encrypted
    this.writeTokens(tokens)
  }

  private writeTokens(tokens: Record<string, string>): void {
    mkdirSync(this.dir, { recursive: true })
    writeJson(this.tokensFile, tokens, 0o600)
  }
}
