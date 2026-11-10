import { useState } from 'react'
import { ArrowRight, Cloud, FolderOpen, GitBranch, Link2, Rocket, Server, MonitorSmartphone } from '@/components/icons'
import { useAdoSettingsStore, useToastStore } from '../../../store'
import type { SettingsPageId } from '../../../store'
import { RELEASE_STAGE_LABELS, promotionConfigKey } from '../../../shared/adoPromotion'
import type { PromotionConfig, ReleaseStage } from '../../../shared/adoPromotion'
import { releaseRepos, sameName, siblingRepos, withBeRepo } from '../../../shared/adoSettings'
import type { AdoConnectionConfig } from '../../../shared/adoSettings'
import { useAdoFolder } from '../../../hooks/useAdoFolder'
import { tr, useI18n } from '../../../i18n'
import { Btn, Card, CardBody, Chip, Loading, Notice, Row, SelectInput, ipcMessage, px } from '../ui'
import { RepoNameSelect, reposOf, useCatalogOnMount } from './adoUi'

// select values that are not repository names
const AUTO = '\u0000auto'
const NONE = '\u0000none'

const STAGE_OPTIONS = (Object.entries(RELEASE_STAGE_LABELS) as [ReleaseStage, string][]).map(([value, label]) => ({ value, label }))

/**
 * BE / FE repositories promoted by the Release panel and the stage it opens on,
 * per connection (the config is keyed by promotionConfigKey(org, project), the
 * same setRelease the panel uses). Every change is saved at once.
 */
export function ReleasePage({ repoPath, onOpenPage }: { repoPath: string | null; onOpenPage: (page: SettingsPageId) => void }) {
  const t = useI18n()
  const settings = useAdoSettingsStore(s => s.settings)
  const catalog = useAdoSettingsStore(s => s.catalog)
  const catalogLoading = useAdoSettingsStore(s => s.catalogLoading)
  const showToast = useToastStore(s => s.showToast)
  const folder = useAdoFolder(repoPath)
  const [saving, setSaving] = useState<string | null>(null)
  useCatalogOnMount()

  const api = window.electronAPI?.adoSettings
  const connections = settings?.connections ?? []
  const currentId = folder.status === 'ready' ? folder.connection?.id ?? null : null
  // the open folder's connection first
  const ordered = [...connections].sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId))

  const save = async (key: string, next: PromotionConfig, message: string) => {
    setSaving(key)
    try {
      await api.setRelease(key, Object.keys(next).length > 0 ? next : null)
      await useAdoSettingsStore.getState().load()
      showToast(message)
    } catch (e) {
      showToast(ipcMessage(e, tr('save failed')), 'error')
    } finally {
      setSaving(null)
    }
  }

  const renderConnection = (c: AdoConnectionConfig) => {
    const key = promotionConfigKey(c.organization, c.project)
    const config = settings?.release[key]
    const folderRepo = c.id === currentId ? folder.repository : null
    const siblings = siblingRepos(settings?.folders ?? {}, c.id, folder.folderKey)
    const eff = releaseRepos(config, folderRepo, siblings)
    const autoFe = releaseRepos({ ...config, feRepo: undefined }, folderRepo, siblings).fe
    const list = catalog[c.id]
    const repos = reposOf(catalog, c.id)
    const busy = saving === key

    const beValue = config?.beRepo ? config.beRepo : AUTO
    // a saved FE equal to the effective BE is not used (FE never equals BE): it shows as automatic
    const feShadowed = !!config?.feRepo && !!eff.be && sameName(config.feRepo, eff.be)
    const feValue = config?.feRepo === undefined || feShadowed ? AUTO : config.feRepo === '' ? NONE : config.feRepo

    const setBe = (v: string) => {
      // FE never equals BE: a saved FE that became the BE goes back to automatic
      const next = withBeRepo(config, v === AUTO ? undefined : v)
      void save(key, next, v === AUTO ? t("BE: the current folder's repository") : t('BE of {project}: {repo}', { project: c.project, repo: v }))
    }
    const setFe = (v: string) => {
      const next: PromotionConfig = { ...(config ?? {}) }
      if (v === AUTO) delete next.feRepo
      else next.feRepo = v === NONE ? '' : v
      void save(key, next, v === AUTO ? t('automatic FE') : v === NONE ? t('{project}: no FE', { project: c.project }) : t('FE of {project}: {repo}', { project: c.project, repo: v }))
    }
    const setStage = (v: string) => {
      const stage = v as ReleaseStage
      void save(key, { ...(config ?? {}), stage }, t('release of {project}: {stage}', { project: c.project, stage: RELEASE_STAGE_LABELS[stage] }))
    }

    const overrides = Object.keys(config?.branches ?? {})
    return (
      <Card key={c.id} accent={c.id === currentId}
        title={<><span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{c.organization} /</span> {c.project}</>}
        icon={<Cloud size={12} />}
        actions={c.id === currentId
          ? <Chip tone="accent" icon={<FolderOpen size={9} />} title={t('used by {name}', { name: folder.folderName })} tip={t('the open folder uses this connection')}>{t('current folder')}</Chip>
          : undefined}
      >
        <Row icon={<Server size={13} />} label={t('BE repository')}
          hint={folderRepo ? t("automatic: {repo}, the current folder's repository", { repo: folderRepo }) : t('automatic: the repository of the folder the Release opens from')}>
          <RepoNameSelect repos={repos} catalogRead={!!list?.ok} value={beValue} onChange={setBe}
            special={[{ value: AUTO, label: folderRepo ? t('automatic ({repo})', { repo: folderRepo }) : t('automatic (current folder)') }]}
            title={t('backend repository')} tip={t('saved for this project; the Release panel uses it as BE')}
            style={{ minWidth: px(200) }} />
        </Row>
        <Row icon={<MonitorSmartphone size={13} />} label={t('FE repository')}
          hint={autoFe ? t('automatic: {repo}, mapped to another folder of this project', { repo: autoFe }) : t('automatic: a repository mapped to another folder of this project')}>
          <RepoNameSelect repos={repos.filter(r => !(eff.be && sameName(r, eff.be)))} catalogRead={!!list?.ok} value={feValue} onChange={setFe}
            special={[
              { value: AUTO, label: autoFe ? t('automatic ({repo})', { repo: autoFe }) : t('automatic (no suggestion)') },
              { value: NONE, label: t('no FE') }
            ]}
            title={t('frontend repository')} tip={t('saved for this project; never the same as the BE')}
            style={{ minWidth: px(200) }} />
        </Row>
        <Row icon={<Link2 size={13} />} label={t('default stage')}
          hint={t('the one the Release panel opens on; develop → qa → prod creates the qa → prod PR by itself as soon as the develop → qa PR is completed')}>
          <SelectInput value={config?.stage ?? 'dev-qa'} options={STAGE_OPTIONS} onChange={setStage}
            title={t('default release stage')} tip={t('saved for this project; the Release panel changes it too')}
            style={{ minWidth: px(200) }} />
        </Row>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: px(10), fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            <Rocket size={11} />
            {t('release:')}
            {eff.be ? <Chip tone="accent">BE {eff.be}</Chip> : <Chip>{t('BE from the current folder')}</Chip>}
            <ArrowRight size={10} />
            {eff.fe ? <Chip tone="accent">FE {eff.fe}</Chip> : <Chip>{t('no FE')}</Chip>}
            {busy && <span>{t('saving…')}</span>}
          </div>
          {!list && catalogLoading && <Loading>{t('reading repositories…')}</Loading>}
          {list && !list.ok && (
            <Notice tone="error" actions={
              <Btn onClick={() => onOpenPage('ado-connections')} title={t('connections')} data-tip-desc={t('Azure DevOps › Connections')}>
                <Cloud size={11} /> {t('connections')}
              </Btn>
            }>
              {t('repositories not read: {error}. The saved choices stay valid.', { error: list.error })}
            </Notice>
          )}
          {overrides.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: px(9.5), fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              <GitBranch size={11} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{t('branches picked by hand for {list}: they are changed in the Release panel', { list: overrides.join(', ') })}</span>
            </div>
          )}
        </CardBody>
      </Card>
    )
  }

  if (!api) return <Notice tone="warning">{t('Azure DevOps settings not available in this window')}</Notice>

  return (
    <>
      {!settings ? (
        <Card><Loading>{t('reading settings…')}</Loading></Card>
      ) : connections.length === 0 ? (
        <Notice tone="warning" actions={
          <Btn variant="primary" onClick={() => onOpenPage('ado-connections')} title={t('add connection')} data-tip-desc={t('Azure DevOps › Connections')}>
            <Cloud size={11} /> {t('set up a connection')}
          </Btn>
        }>
          {t("no Azure DevOps connection configured: the release uses the current folder's connection.")}
        </Notice>
      ) : (
        <>
          <Notice tone="info" icon={<Rocket size={12} />}>
            {t('the same choices as the Release panel, per project: every change is saved at once and applies to every window and instance of the IDE.')}
          </Notice>
          {ordered.map(renderConnection)}
        </>
      )}
    </>
  )
}
