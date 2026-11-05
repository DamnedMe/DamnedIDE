import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAdoSettingsStore } from '../store'
import { folderKey as toFolderKey, folderName as toFolderName, mainFolderPath, resolveFolderRepo } from '../shared/adoSettings'
import type { AdoConnectionConfig, AdoRepoRef } from '../shared/adoSettings'

export interface AdoFolderState {
  /**
   * loading: main folder, settings or catalog not read yet; ready: connection +
   * repository known; ambiguous / none: the user must choose (candidates);
   * no-connections: nothing configured in Settings; error: every connection's
   * catalog failed (errors). With repoPath null: 'none', folderPath null, no candidates.
   */
  status: 'loading' | 'ready' | 'ambiguous' | 'none' | 'no-connections' | 'error'
  /** main checkout of repoPath (a linked worktree resolves to its main repository) */
  folderPath: string | null
  folderKey: string | null
  /** last segment of the main folder: the ADO repository name looked for */
  folderName: string
  /** set when ready */
  connection: AdoConnectionConfig | null
  /** set when ready */
  repository: string | null
  /** ambiguous / none */
  candidates: AdoRepoRef[]
  /** catalog errors, as `org/project: message` (status 'error' when every connection failed) */
  errors: string[]
  /** saves the mapping for this folder (Settings › Azure DevOps › Repository per cartella); then ready */
  choose: (ref: AdoRepoRef) => Promise<void>
}

/**
 * Azure DevOps connection + repository used by the folder opened as `repoPath`:
 * the saved mapping (no network), else the only same-name repository across the
 * connections (saved on the spot once every catalog was read, so it stays stable
 * and shows in Settings), else the user chooses (ambiguous / none).
 */
export function useAdoFolder(repoPath: string | null): AdoFolderState {
  const settings = useAdoSettingsStore(s => s.settings)
  const catalog = useAdoSettingsStore(s => s.catalog)
  const catalogLoading = useAdoSettingsStore(s => s.catalogLoading)
  const loadCatalog = useAdoSettingsStore(s => s.loadCatalog)

  // main folder of repoPath, from git's common dir
  const [main, setMain] = useState<{ repoPath: string; folder: string } | null>(null)
  useEffect(() => {
    if (!repoPath) return
    let cancelled = false
    Promise.resolve()
      .then(() => window.electronAPI.git.gitCommonDir(repoPath))
      .catch(() => null)
      .then(dir => { if (!cancelled) setMain({ repoPath, folder: mainFolderPath(repoPath, dir || null) }) })
    return () => { cancelled = true }
  }, [repoPath])

  const folderPath = repoPath && main?.repoPath === repoPath ? main.folder : null
  const key = folderPath ? toFolderKey(folderPath) : null
  const name = toFolderName(folderPath ?? repoPath ?? '')
  const connections = useMemo(() => settings?.connections ?? [], [settings])
  const saved = key ? settings?.folders[key] : undefined
  const savedValid = !!saved && connections.some(c => c.id === saved.connectionId)
  const needCatalog = !!settings && !!key && connections.length > 0 && !savedValid
  const connSig = connections.map(c => c.id).join('|')

  // the catalog is read once per set of connections (the main process caches it)
  const [requested, setRequested] = useState<string | null>(null)
  useEffect(() => {
    if (!needCatalog || requested === connSig) return
    setRequested(connSig)
    void loadCatalog()
  }, [needCatalog, connSig, requested, loadCatalog])
  const waiting = needCatalog && (requested !== connSig || catalogLoading)

  const resolution = useMemo(
    () => (settings && key && !waiting ? resolveFolderRepo(name, saved, connections, catalog) : null),
    [settings, key, waiting, name, saved, connections, catalog]
  )

  // a unique same-name repository is remembered for this folder, but only once
  // every connection's catalog was read: with one missing or failed the match is
  // not proven unique, so it is used for the session and resolved again later
  const autoSaved = useRef<string | null>(null)
  const autoRef = resolution?.status === 'auto' ? resolution.ref : null
  const autoSig = autoRef && key ? `${key}|${autoRef.connectionId}|${autoRef.repository}` : null
  const catalogComplete = connections.every(c => catalog[c.id]?.ok)
  useEffect(() => {
    if (!autoRef || !key || !autoSig || !catalogComplete || autoSaved.current === autoSig) return
    autoSaved.current = autoSig
    window.electronAPI.adoSettings.setFolder(key, autoRef)
      .catch(e => console.error('[ado] salvataggio repository della cartella fallito:', (e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSig, catalogComplete])

  const choose = useCallback(async (ref: AdoRepoRef) => {
    if (!key) throw new Error('nessuna cartella aperta')
    await window.electronAPI.adoSettings.setFolder(key, ref)
    await useAdoSettingsStore.getState().load()
  }, [key])

  return useMemo<AdoFolderState>(() => {
    const base = {
      folderPath, folderKey: key, folderName: name,
      connection: null, repository: null, candidates: [] as AdoRepoRef[], errors: [] as string[], choose
    }
    if (!repoPath) return { ...base, status: 'none' }
    if (!settings || !folderPath) return { ...base, status: 'loading' }
    if (connections.length === 0) return { ...base, status: 'no-connections' }
    if (!resolution) return { ...base, status: 'loading' }
    if ('ref' in resolution) {
      const connection = connections.find(c => c.id === resolution.ref.connectionId) ?? null
      return { ...base, status: 'ready', connection, repository: resolution.ref.repository }
    }
    if (!('candidates' in resolution)) return { ...base, status: 'no-connections' }
    const errors: string[] = []
    let failed = 0
    for (const c of connections) {
      const list = catalog[c.id]
      if (list && !list.ok) {
        failed++
        errors.push(`${c.organization}/${c.project}: ${list.error}`)
      }
    }
    const status = resolution.status === 'none' && failed === connections.length ? 'error' : resolution.status
    return { ...base, status, candidates: resolution.candidates, errors }
  }, [repoPath, settings, folderPath, key, name, connections, resolution, catalog, choose])
}
