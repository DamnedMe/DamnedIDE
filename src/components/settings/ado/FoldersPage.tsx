import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Cloud, Eraser, FolderGit2, FolderOpen, GitFork, Loader2, RefreshCw } from '@/components/icons'
import { useAdoSettingsStore, useToastStore } from '../../../store'
import type { SettingsPageId } from '../../../store'
import { folderKey as toFolderKey, folderName } from '../../../shared/adoSettings'
import type { AdoConnectionConfig, AdoRepoRef } from '../../../shared/adoSettings'
import { useAdoFolder } from '../../../hooks/useAdoFolder'
import { tr, useI18n } from '../../../i18n'
import { Btn, Card, CardBody, Chip, Loading, Notice, PathText, SubHeading, ipcMessage, px, spin } from '../ui'
import { RepoRefSelect, connectionLabel, encodeRef, useCatalogOnMount } from './adoUi'

/** The ADO repository used by each local folder (main checkout); the open folder comes first. */
export function FoldersPage({ repoPath, onOpenPage }: { repoPath: string | null; onOpenPage: (page: SettingsPageId) => void }) {
  const t = useI18n()
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
    return c
      ? tr('{name} uses {repo} ({connection})', { name, repo: ref.repository, connection: connectionLabel(c) })
      : tr('{name} uses {repo}', { name, repo: ref.repository })
  }

  const setFolder = async (key: string, ref: AdoRepoRef | null, done?: string) => {
    setBusy(key)
    try {
      await api.setFolder(key, ref)
      await useAdoSettingsStore.getState().load()
      if (done) showToast(done)
    } catch (e) {
      showToast(ipcMessage(e, tr('save failed')), 'error')
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
      showToast(ipcMessage(e, tr('save failed')), 'error')
    } finally {
      setBusy(null)
    }
  }

  const catalogErrors = connections
    .map(c => ({ c, list: catalog[c.id] }))
    .filter((x): x is { c: AdoConnectionConfig; list: { ok: false; error: string } } => !!x.list && !x.list.ok)

  const refresh = (
    <Btn onClick={() => { void loadCatalog(true) }} disabled={catalogLoading}
      title={t('read the repositories again')} data-tip-desc={t('reads the repository list of every connection from Azure DevOps again')}>
      {catalogLoading ? <Loader2 size={11} style={spin} /> : <RefreshCw size={11} />} {t('refresh list')}
    </Btn>
  )

  // ─── the open folder ───
  const currentKey = folder.folderKey
  const shownPath = folder.folderPath ?? repoPath
  const isWorktree = !!repoPath && !!folder.folderPath && toFolderKey(repoPath) !== toFolderKey(folder.folderPath)

  const renderCurrent = () => {
    if (!repoPath) {
      return (
        <Card title={t('Current folder')} icon={<FolderOpen size={12} />}>
          <CardBody>
            <Notice>{t('no folder open: open a repository to choose its Azure DevOps repository.')}</Notice>
          </CardBody>
        </Card>
      )
    }
    let body: ReactNode
    switch (folder.status) {
      case 'loading':
        body = <Loading>{t('looking for the repository «{name}»…', { name: folder.folderName })}</Loading>
        break
      case 'no-connections':
        body = (
          <CardBody>
            <Notice tone="warning" actions={
              <Btn variant="primary" onClick={() => onOpenPage('ado-connections')} title={t('add connection')} data-tip-desc={t('Azure DevOps › Connections')}>
                <Cloud size={11} /> {t('set up a connection')}
              </Btn>
            }>
              {t('no Azure DevOps connection configured.')}
            </Notice>
          </CardBody>
        )
        break
      case 'ready':
        body = (
          <CardBody>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Chip tone="success" icon={<Check size={9} />}>{t('in use')}</Chip>
              <RepoRefSelect connections={connections} catalog={catalog}
                value={folder.connection && folder.repository ? { connectionId: folder.connection.id, repository: folder.repository } : null}
                onChange={(ref) => { if (currentKey) void setFolder(currentKey, ref, usesMsg(folder.folderName, ref)) }}
                disabled={busy === currentKey}
                title={t("this folder's Azure DevOps repository")} tip={t('used by DevOps, Release and Worktree for this folder')}
                style={{ flex: '1 1 220px' }} />
              <Btn onClick={() => { if (currentKey) void setFolder(currentKey, null, t('choice forgotten')) }} disabled={busy === currentKey}
                title={t('forget')} data-tip-desc={t('forgets the choice: the folder looks for the repository with its own name again')}>
                <Eraser size={11} /> {t('forget')}
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
                ? <>{t('more Azure DevOps repositories are named «{name}»: choose which one to use for this folder', { name: folder.folderName })}</>
                : <>{t('no Azure DevOps repository is named «{name}»: choose which one to use for this folder', { name: folder.folderName })}</>}
            </Notice>
            {folder.candidates.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <RepoRefSelect connections={connections} catalog={catalog} refs={folder.candidates}
                  value={pick} onChange={setPick}
                  title={t('repository for this folder')} tip={t('the choice is remembered for this folder')}
                  style={{ flex: '1 1 220px' }} />
                <Btn variant="primary" onClick={() => { void choose() }} disabled={!pick || busy === currentKey}
                  title={t('use and remember')} data-tip-desc={t('saves the choice for this folder (shared by every IDE window)')}>
                  {busy === currentKey ? <Loader2 size={11} style={spin} /> : <Check size={11} />} {t('use and remember')}
                </Btn>
              </div>
            ) : (
              <Notice actions={refresh}>{t('no readable repository in the configured connections.')}</Notice>
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
                <Btn onClick={() => onOpenPage('ado-connections')} title={t('connections')} data-tip-desc={t('Azure DevOps › Connections')}>
                  <Cloud size={11} /> {t('connections')}
                </Btn>
              </>
            }>
              {t('Azure DevOps does not return the repositories:')}
              {folder.errors.map(e => <div key={e}>{e}</div>)}
            </Notice>
          </CardBody>
        )
        break
    }
    return (
      <Card accent
        title={<>{t('Current folder')} <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>· {folder.folderName}</span></>}
        icon={<FolderOpen size={12} />}
        description={
          <>
            <PathText muted>{shownPath}</PathText>
            {isWorktree && <> — {t('worktree of')} <PathText muted>{folderName(folder.folderPath ?? '')}</PathText>: {t("uses the main folder's repository")}</>}
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

  if (!api) return <Notice tone="warning">{t('Azure DevOps settings not available in this window')}</Notice>

  return (
    <>
      {!settings ? <Card><Loading>{t('reading settings…')}</Loading></Card> : renderCurrent()}

      {settings && connections.length > 0 && (
        <>
          <SubHeading actions={refresh}>{t('other folders ({n})', { n: others.length })}</SubHeading>
          {others.length === 0 ? (
            <Notice>
              {t('no other folder mapped. Every folder uses the repository with its own name; when it is not clear which one, DevOps, Release and Worktree ask and the choice shows up here.')}
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
                        title={c ? `repository (${connectionLabel(c)})` : 'repository'} tip={t('repository Azure DevOps used by this folder')}
                        style={{ flex: '1 1 180px' }} />
                      <Btn onClick={() => { void setFolder(key, null, t('folder forgotten')) }} disabled={busy === key}
                        title={t('forget')} data-tip-desc={t('forgets this folder: next time it looks for the repository with its own name')}>
                        {busy === key ? <Loader2 size={11} style={spin} /> : <Eraser size={11} />} {t('forget')}
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
          {t('repositories not read from {list}', { list: catalogErrors.map(x => `${connectionLabel(x.c)} (${x.list.error})`).join(' · ') })}
        </Notice>
      )}

      <Notice tone="info" icon={<GitFork size={12} />}>
        {t('a worktree uses the repository of its main folder. The choices are shared by every window and instance of the IDE.')}
      </Notice>
    </>
  )
}
