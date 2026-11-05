import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Cloud, Eraser, FolderGit2, FolderOpen, GitFork, Loader2, RefreshCw } from '@/components/icons'
import { useAdoSettingsStore, useToastStore } from '../../../store'
import type { SettingsPageId } from '../../../store'
import { folderKey as toFolderKey, folderName } from '../../../shared/adoSettings'
import type { AdoConnectionConfig, AdoRepoRef } from '../../../shared/adoSettings'
import { useAdoFolder } from '../../../hooks/useAdoFolder'
import { Btn, Card, CardBody, Chip, Loading, Notice, PathText, SubHeading, ipcMessage, px, spin } from '../ui'
import { RepoRefSelect, connectionLabel, encodeRef, useCatalogOnMount } from './adoUi'

/** The ADO repository used by each local folder (main checkout); the open folder comes first. */
export function FoldersPage({ repoPath, onOpenPage }: { repoPath: string | null; onOpenPage: (page: SettingsPageId) => void }) {
  const settings = useAdoSettingsStore(s => s.settings)
  const catalog = useAdoSettingsStore(s => s.catalog)
  const catalogLoading = useAdoSettingsStore(s => s.catalogLoading)
  const loadCatalog = useAdoSettingsStore(s => s.loadCatalog)
  const showToast = useToastStore(s => s.showToast)
  const folder = useAdoFolder(repoPath)
  const [busy, setBusy] = useState<string | null>(null)
  // pick for an ambiguous / unmapped open folder, before "usa e ricorda"
  const [pick, setPick] = useState<AdoRepoRef | null>(null)
  useCatalogOnMount()

  const candidatesSig = folder.candidates.map(encodeRef).join('|')
  useEffect(() => {
    // a single candidate is the obvious default; otherwise the user picks
    setPick(folder.candidates.length === 1 ? folder.candidates[0] : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatesSig])

  const connections = settings?.connections ?? []
  const api = window.electronAPI?.adoSettings
  const usesMsg = (name: string, ref: AdoRepoRef) => {
    const c = connections.find(x => x.id === ref.connectionId)
    return `${name} usa ${ref.repository}${c ? ` (${connectionLabel(c)})` : ""}`
  }

  const setFolder = async (key: string, ref: AdoRepoRef | null, done?: string) => {
    setBusy(key)
    try {
      await api.setFolder(key, ref)
      await useAdoSettingsStore.getState().load()
      if (done) showToast(done)
    } catch (e) {
      showToast(ipcMessage(e, 'salvataggio fallito'), 'error')
    } finally {
      setBusy(null)
    }
  }

  const choose = async () => {
    if (!pick || !folder.folderKey) return
    setBusy(folder.folderKey)
    try {
      await folder.choose(pick)
      showToast(usesMsg(folder.folderName, pick))
    } catch (e) {
      showToast(ipcMessage(e, 'salvataggio fallito'), 'error')
    } finally {
      setBusy(null)
    }
  }

  const catalogErrors = connections
    .map(c => ({ c, list: catalog[c.id] }))
    .filter((x): x is { c: AdoConnectionConfig; list: { ok: false; error: string } } => !!x.list && !x.list.ok)

  const refresh = (
    <Btn onClick={() => { void loadCatalog(true) }} disabled={catalogLoading}
      title="rileggi le repository" data-tip-desc="reads the repository list of every connection from Azure DevOps again">
      {catalogLoading ? <Loader2 size={11} style={spin} /> : <RefreshCw size={11} />} aggiorna elenco
    </Btn>
  )

  // ─── the open folder ───
  const currentKey = folder.folderKey
  const shownPath = folder.folderPath ?? repoPath
  const isWorktree = !!repoPath && !!folder.folderPath && toFolderKey(repoPath) !== toFolderKey(folder.folderPath)

  const renderCurrent = () => {
    if (!repoPath) {
      return (
        <Card title="Cartella aperta" icon={<FolderOpen size={12} />}>
          <CardBody>
            <Notice>nessuna cartella aperta: apri un repository per scegliere la sua repository Azure DevOps.</Notice>
          </CardBody>
        </Card>
      )
    }
    let body: ReactNode
    switch (folder.status) {
      case 'loading':
        body = <Loading>ricerca della repository «{folder.folderName}»…</Loading>
        break
      case 'no-connections':
        body = (
          <CardBody>
            <Notice tone="warning" actions={
              <Btn variant="primary" onClick={() => onOpenPage('ado-connections')} title="aggiungi connessione" data-tip-desc="Azure DevOps › Connessioni">
                <Cloud size={11} /> configura una connessione
              </Btn>
            }>
              nessuna connessione Azure DevOps configurata.
            </Notice>
          </CardBody>
        )
        break
      case 'ready':
        body = (
          <CardBody>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Chip tone="success" icon={<Check size={9} />}>in uso</Chip>
              <RepoRefSelect connections={connections} catalog={catalog}
                value={folder.connection && folder.repository ? { connectionId: folder.connection.id, repository: folder.repository } : null}
                onChange={(ref) => { if (currentKey) void setFolder(currentKey, ref, usesMsg(folder.folderName, ref)) }}
                disabled={busy === currentKey}
                title="repository Azure DevOps di questa cartella" tip="used by DevOps, Release and Worktree for this folder"
                style={{ flex: '1 1 220px' }} />
              <Btn onClick={() => { if (currentKey) void setFolder(currentKey, null, 'scelta dimenticata') }} disabled={busy === currentKey}
                title="dimentica" data-tip-desc="forgets the choice: the folder looks for the repository with its own name again">
                <Eraser size={11} /> dimentica
              </Btn>
            </div>
          </CardBody>
        )
        break
      case 'ambiguous':
      case 'none':
        body = (
          <CardBody>
            <Notice tone="warning">
              {folder.status === 'ambiguous'
                ? <>più repository Azure DevOps si chiamano «{folder.folderName}»: scegli quale usare per questa cartella</>
                : <>nessuna repository Azure DevOps si chiama «{folder.folderName}»: scegli quale usare per questa cartella</>}
            </Notice>
            {folder.candidates.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <RepoRefSelect connections={connections} catalog={catalog} refs={folder.candidates}
                  value={pick} onChange={setPick}
                  title="repository per questa cartella" tip="the choice is remembered for this folder"
                  style={{ flex: '1 1 220px' }} />
                <Btn variant="primary" onClick={() => { void choose() }} disabled={!pick || busy === currentKey}
                  title="usa e ricorda" data-tip-desc="saves the choice for this folder (shared by every IDE window)">
                  {busy === currentKey ? <Loader2 size={11} style={spin} /> : <Check size={11} />} usa e ricorda
                </Btn>
              </div>
            ) : (
              <Notice actions={refresh}>nessuna repository leggibile nelle connessioni configurate.</Notice>
            )}
          </CardBody>
        )
        break
      case 'error':
        body = (
          <CardBody>
            <Notice tone="error" actions={
              <>
                {refresh}
                <Btn onClick={() => onOpenPage('ado-connections')} title="connessioni" data-tip-desc="Azure DevOps › Connessioni">
                  <Cloud size={11} /> connessioni
                </Btn>
              </>
            }>
              Azure DevOps non restituisce le repository:
              {folder.errors.map(e => <div key={e}>{e}</div>)}
            </Notice>
          </CardBody>
        )
        break
    }
    return (
      <Card accent
        title={<>Cartella aperta <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>· {folder.folderName}</span></>}
        icon={<FolderOpen size={12} />}
        description={
          <>
            <PathText muted>{shownPath}</PathText>
            {isWorktree && <> — worktree di <PathText muted>{folderName(folder.folderPath ?? '')}</PathText>: usa la repository della cartella principale</>}
          </>
        }
      >
        {body}
      </Card>
    )
  }

  // ─── the other saved folders ───
  const others = Object.entries(settings?.folders ?? {})
    .filter(([key]) => key !== currentKey)
    .sort(([a], [b]) => a.localeCompare(b))

  if (!api) return <Notice tone="warning">impostazioni Azure DevOps non disponibili in questa finestra</Notice>

  return (
    <>
      {!settings ? <Card><Loading>lettura impostazioni…</Loading></Card> : renderCurrent()}

      {settings && connections.length > 0 && (
        <>
          <SubHeading actions={refresh}>altre cartelle ({others.length})</SubHeading>
          {others.length === 0 ? (
            <Notice>
              nessun'altra cartella associata. Ogni cartella usa la repository con il suo stesso nome; se non è chiaro quale,
              DevOps, Rilascio e Worktree lo chiedono e la scelta compare qui.
            </Notice>
          ) : (
            <Card>
              {others.map(([key, ref]) => {
                const c = connections.find(x => x.id === ref.connectionId)
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px 12px', flexWrap: 'wrap', padding: '9px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flex: '1 1 220px', minWidth: 0 }}>
                      <FolderGit2 size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }} />
                      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
                        <span style={{ fontSize: px(11), color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{folderName(key)}</span>
                        <PathText muted>{key}</PathText>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '1 1 260px', minWidth: 0, justifyContent: 'flex-end' }}>
                      <RepoRefSelect connections={connections} catalog={catalog} value={ref}
                        onChange={(next) => { void setFolder(key, next, usesMsg(folderName(key), next)) }}
                        disabled={busy === key}
                        title={c ? `repository (${connectionLabel(c)})` : 'repository'} tip="repository Azure DevOps used by this folder"
                        style={{ flex: '1 1 180px' }} />
                      <Btn onClick={() => { void setFolder(key, null, 'cartella dimenticata') }} disabled={busy === key}
                        title="dimentica" data-tip-desc="forgets this folder: next time it looks for the repository with its own name">
                        {busy === key ? <Loader2 size={11} style={spin} /> : <Eraser size={11} />} dimentica
                      </Btn>
                    </div>
                  </div>
                )
              })}
            </Card>
          )}
        </>
      )}

      {catalogErrors.length > 0 && folder.status !== 'error' && (
        <Notice tone="warning">
          repository non lette da {catalogErrors.map(x => `${connectionLabel(x.c)} (${x.list.error})`).join(' · ')}
        </Notice>
      )}

      <Notice tone="info" icon={<GitFork size={12} />}>
        un worktree usa la repository della sua cartella principale. Le scelte sono condivise da tutte le finestre e le istanze dell'IDE.
      </Notice>
    </>
  )
}
