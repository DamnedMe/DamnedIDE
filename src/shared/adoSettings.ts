// Azure DevOps settings of the IDE: connections (organization + project, the PAT
// stays encrypted in the main process), the ADO repository used by each local
// folder and the release BE/FE choice per org/project. Pure helpers shared by the
// main-process store (electron/services/ado/ado-settings.store.ts), the renderer
// and scripts/ado-settings.check.ts: type imports only, so plain node can run it.
import type { EnvRole, PromotionConfig, ReleaseStage } from './adoPromotion'

export interface AdoConnectionConfig {
  id: string
  organization: string
  project: string
}

/** An ADO repository of one connection. */
export interface AdoRepoRef {
  connectionId: string
  repository: string
}

export interface AdoSettings {
  connections: AdoConnectionConfig[]
  /** folderKey(main folder) -> repository used by that folder */
  folders: Record<string, AdoRepoRef>
  /** promotionConfigKey(org, project) -> release settings (BE/FE repository, branch overrides) */
  release: Record<string, PromotionConfig>
}

/** What the renderer gets: the settings plus, per connection id, whether a PAT is saved (never the PAT). */
export interface AdoSettingsView extends AdoSettings {
  tokens: Record<string, boolean>
}

export type AdoRepoList = { ok: true; repos: string[] } | { ok: false; error: string }

export type FolderResolution =
  | { status: 'saved' | 'auto'; ref: AdoRepoRef }
  | { status: 'ambiguous' | 'none'; candidates: AdoRepoRef[] }
  | { status: 'no-connections' }

/** adoSettings:saveConnection input: no id = new connection (PAT required); no token on an edit keeps the saved PAT. */
export interface AdoConnectionInput {
  id?: string
  organization: string
  project: string
  token?: string
}

/** One entry of the old localStorage `damnedide_ado_connections` map (PAT in plaintext). */
export interface AdoLegacyConnection {
  organization?: string
  project?: string
  repository?: string
  token?: string
}

const ENV_ROLES: EnvRole[] = ['dev', 'qa', 'prod']
// the ReleaseStage values (adoPromotion.ts), repeated here to keep this module import-free
const RELEASE_STAGES: ReadonlySet<unknown> = new Set<ReleaseStage>(['dev-qa', 'qa-prod', 'dev-qa-prod'])

/** What every Azure DevOps consumer says when main cannot use a connection (ado:use answered false). */
export const ADO_MISSING_PAT = 'PAT mancante o non leggibile: inseriscilo in Impostazioni › Azure DevOps › Connessioni'

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
/** ADO repository and branch names compare case-insensitively */
export const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
/** Same rule as promotionConfigKey (adoPromotion.ts), repeated here to keep this module import-free. */
const connectionKey = (org: string, project: string): string => `${org.trim()}/${project.trim()}`.toLowerCase()

/**
 * `https://dev.azure.com/org/project/...` or `https://org.visualstudio.com/project`
 * (pasted in the organization field) -> organization and, when present, project.
 * null when `v` is not such a URL.
 */
export function parseAdoUrl(v: string): { organization: string; project?: string } | null {
  const dec = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
  const project = (p?: string) => (p && !p.startsWith('_') ? dec(p) : undefined)
  const a = /^\s*https?:\/\/dev\.azure\.com\/([^/?#\s]+)(?:\/([^/?#\s]+))?/i.exec(v)
  if (a) return { organization: dec(a[1]), project: project(a[2]) }
  const b = /^\s*https?:\/\/([^./\s]+)\.visualstudio\.com(?:\/(?:DefaultCollection\/)?([^/?#\s]+))?/i.exec(v)
  if (b) return { organization: dec(b[1]), project: project(b[2]) }
  return null
}

/** The same folder opened as `C:\x\` or `c:/x` is one key. */
export function folderKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * The main checkout of `repoPath`: when git's common dir (`git rev-parse
 * --git-common-dir`, absolute) is `<main>/.git`, that is `<main>` — a linked
 * worktree resolves to its main repository. Otherwise (unknown, bare, submodule)
 * `repoPath` itself.
 */
export function mainFolderPath(repoPath: string, gitCommonDir: string | null): string {
  const dir = (gitCommonDir ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const absolute = /^([A-Za-z]:)?\//.test(dir)
  if (!absolute || !/\/\.git$/i.test(dir)) return repoPath
  const parent = dir.slice(0, -'/.git'.length)
  // `C:/.git` -> `C:/`, `/.git` -> `/`
  return parent === '' || /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent
}

/** Last segment of a path (`C:\repos\Themis-API\` -> `Themis-API`). */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : path
}

export function emptyAdoSettings(): AdoSettings {
  return { connections: [], folders: {}, release: {} }
}

/** Tolerant parse of one release config: unknown fields and empty branch names are dropped. */
export function sanitizePromotionConfig(raw: unknown): PromotionConfig {
  const out: PromotionConfig = {}
  if (!isRecord(raw)) return out
  // '' is a choice ("no FE"), so it is kept: only non-strings are dropped
  if (typeof raw.beRepo === 'string') out.beRepo = raw.beRepo.trim()
  if (typeof raw.feRepo === 'string') out.feRepo = raw.feRepo.trim()
  if (isRecord(raw.branches)) {
    const branches: NonNullable<PromotionConfig['branches']> = {}
    for (const [repo, roles] of Object.entries(raw.branches)) {
      if (!repo || !isRecord(roles)) continue
      const picked: Partial<Record<EnvRole, string>> = {}
      for (const role of ENV_ROLES) {
        const branch = text(roles[role])
        if (branch) picked[role] = branch
      }
      if (Object.keys(picked).length > 0) branches[repo] = picked
    }
    if (Object.keys(branches).length > 0) out.branches = branches
  }
  if (RELEASE_STAGES.has(raw.stage)) out.stage = raw.stage as ReleaseStage
  return out
}

/**
 * Tolerant parse of `ado-settings.json`: anything malformed is dropped, never
 * thrown. Connections need id, organization and project (first id wins); folder
 * mappings need an existing connection and a repository name.
 */
export function sanitizeAdoSettings(raw: unknown): AdoSettings {
  const out = emptyAdoSettings()
  if (!isRecord(raw)) return out
  const ids = new Set<string>()
  for (const c of Array.isArray(raw.connections) ? raw.connections : []) {
    if (!isRecord(c)) continue
    const id = text(c.id)
    const organization = text(c.organization)
    const project = text(c.project)
    if (!id || !organization || !project || ids.has(id)) continue
    ids.add(id)
    out.connections.push({ id, organization, project })
  }
  if (isRecord(raw.folders)) {
    for (const [key, ref] of Object.entries(raw.folders)) {
      if (!isRecord(ref)) continue
      const k = folderKey(key)
      const connectionId = text(ref.connectionId)
      const repository = text(ref.repository)
      if (k && repository && ids.has(connectionId)) out.folders[k] = { connectionId, repository }
    }
  }
  if (isRecord(raw.release)) {
    for (const [key, config] of Object.entries(raw.release)) {
      const k = key.trim().toLowerCase()
      const clean = sanitizePromotionConfig(config)
      if (k && Object.keys(clean).length > 0) out.release[k] = clean
    }
  }
  return out
}

/**
 * Which ADO repository a folder named `name` uses:
 * 1. the saved mapping, while its connection exists ('saved', no network needed);
 * 2. the only repository with the same name (case-insensitive) across every
 *    connection's catalog ('auto': the caller saves it, so it stays stable);
 * 3. otherwise the user chooses: 'ambiguous' (several same-name repositories,
 *    those are the candidates) or 'none' (no same-name repository: every
 *    readable repository is a candidate).
 * Connections whose catalog is missing or failed contribute nothing, so an
 * 'auto' match is then not proven unique: the caller uses it for the session
 * but must not save it until every connection's catalog was read.
 */
export function resolveFolderRepo(
  name: string,
  saved: AdoRepoRef | undefined,
  connections: AdoConnectionConfig[],
  catalog: Record<string, AdoRepoList | undefined>
): FolderResolution {
  if (connections.length === 0) return { status: 'no-connections' }
  if (saved && connections.some(c => c.id === saved.connectionId)) return { status: 'saved', ref: saved }
  const all: AdoRepoRef[] = []
  for (const c of connections) {
    const list = catalog[c.id]
    if (list?.ok) for (const repository of list.repos) all.push({ connectionId: c.id, repository })
  }
  const wanted = name.trim()
  const same = wanted ? all.filter(r => sameName(r.repository, wanted)) : []
  if (same.length === 1) return { status: 'auto', ref: same[0] }
  if (same.length > 1) return { status: 'ambiguous', candidates: same }
  return { status: 'none', candidates: all }
}

/**
 * One-time import of the old localStorage data. `legacy` is the
 * `damnedide_ado_connections` map (folderKey -> connection); an entry whose key
 * is not a folder (the renderer passes the very old single global connection
 * under '') only adds its connection. Connections are deduped by
 * promotionConfigKey(org, project), in order: the first non-empty PAT wins.
 * `promotion` (`damnedide_ado_promotion`) becomes the release map.
 */
export function migrateLegacyAdo(
  legacy: Record<string, AdoLegacyConnection>,
  promotion: Record<string, PromotionConfig>,
  makeId: () => string
): { settings: AdoSettings; tokens: Record<string, string> } {
  const settings = emptyAdoSettings()
  const tokens: Record<string, string> = {}
  const byKey = new Map<string, AdoConnectionConfig>()
  for (const [path, entry] of Object.entries(isRecord(legacy) ? legacy : {})) {
    if (!isRecord(entry)) continue
    const organization = text(entry.organization)
    const project = text(entry.project)
    if (!organization || !project) continue
    const key = connectionKey(organization, project)
    let connection = byKey.get(key)
    if (!connection) {
      connection = { id: makeId(), organization, project }
      byKey.set(key, connection)
      settings.connections.push(connection)
    }
    const token = text(entry.token)
    if (token && !tokens[connection.id]) tokens[connection.id] = token
    const repository = text(entry.repository)
    const folder = folderKey(path)
    if (folder && repository) settings.folders[folder] = { connectionId: connection.id, repository }
  }
  settings.release = sanitizeAdoSettings({ release: isRecord(promotion) ? promotion : {} }).release
  return { settings, tokens }
}

/** Repositories mapped to the folders of one connection, except `exceptKey` (the current folder). */
export function siblingRepos(folders: Record<string, AdoRepoRef>, connectionId: string, exceptKey?: string | null): string[] {
  const out: string[] = []
  for (const [key, ref] of Object.entries(folders)) {
    if (key === exceptKey || ref.connectionId !== connectionId) continue
    if (!out.some(r => sameName(r, ref.repository))) out.push(ref.repository)
  }
  return out
}

/**
 * Release repositories of a project: BE = the saved choice, else the folder's
 * repository; FE = the saved choice, else the first repository mapped to another
 * folder of the same connection (`siblings`), else ''. FE never equals BE.
 */
export function releaseRepos(config: PromotionConfig | undefined, folderRepo: string | null, siblings: string[]): { be: string; fe: string } {
  const be = config?.beRepo ?? folderRepo ?? ''
  const suggestion = siblings.find(s => !!s && !(be && sameName(s, be))) ?? ''
  let fe = config?.feRepo ?? suggestion
  if (fe && be && sameName(fe, be)) fe = suggestion
  return { be, fe }
}

/**
 * The release config with `repo` as BE (undefined: back to the folder's
 * repository). A saved FE equal to the new BE goes back to automatic, so the
 * Release panel and Settings › Rilascio save the same thing.
 */
export function withBeRepo(config: PromotionConfig | undefined, repo: string | undefined): PromotionConfig {
  const next: PromotionConfig = { ...(config ?? {}) }
  if (repo === undefined) delete next.beRepo
  else next.beRepo = repo
  if (repo && next.feRepo && sameName(next.feRepo, repo)) delete next.feRepo
  return next
}
