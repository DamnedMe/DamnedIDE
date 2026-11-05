import { useState } from 'react'
import { ArrowRight, Cloud, FolderOpen, GitBranch, Link2, Rocket, Server, MonitorSmartphone } from '@/components/icons'
import { useAdoSettingsStore, useToastStore } from '../../../store'
import type { SettingsPageId } from '../../../store'
import { RELEASE_STAGE_LABELS, promotionConfigKey } from '../../../shared/adoPromotion'
import type { PromotionConfig, ReleaseStage } from '../../../shared/adoPromotion'
import { releaseRepos, sameName, siblingRepos, withBeRepo } from '../../../shared/adoSettings'
import type { AdoConnectionConfig } from '../../../shared/adoSettings'
import { useAdoFolder } from '../../../hooks/useAdoFolder'
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
      showToast(ipcMessage(e, 'salvataggio fallito'), 'error')
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
      void save(key, next, v === AUTO ? 'BE: repository della cartella aperta' : `BE di ${c.project}: ${v}`)
    }
    const setFe = (v: string) => {
      const next: PromotionConfig = { ...(config ?? {}) }
      if (v === AUTO) delete next.feRepo
      else next.feRepo = v === NONE ? '' : v
      void save(key, next, v === AUTO ? 'FE automatico' : v === NONE ? `${c.project}: nessun FE` : `FE di ${c.project}: ${v}`)
    }
    const setStage = (v: string) => {
      const stage = v as ReleaseStage
      void save(key, { ...(config ?? {}), stage }, `rilascio di ${c.project}: ${RELEASE_STAGE_LABELS[stage]}`)
    }

    const overrides = Object.keys(config?.branches ?? {})
    return (
      <Card key={c.id} accent={c.id === currentId}
        title={<><span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{c.organization} /</span> {c.project}</>}
        icon={<Cloud size={12} />}
        actions={c.id === currentId
          ? <Chip tone="accent" icon={<FolderOpen size={9} />} title={`usata da ${folder.folderName}`} tip="the open folder uses this connection">cartella aperta</Chip>
          : undefined}
      >
        <Row icon={<Server size={13} />} label="repository BE"
          hint={folderRepo ? `automatico: ${folderRepo}, la repository della cartella aperta` : 'automatico: la repository della cartella da cui si apre il Rilascio'}>
          <RepoNameSelect repos={repos} catalogRead={!!list?.ok} value={beValue} onChange={setBe}
            special={[{ value: AUTO, label: folderRepo ? `automatico (${folderRepo})` : 'automatico (cartella aperta)' }]}
            title="repository del backend" tip="saved for this project; the Release panel uses it as BE"
            style={{ minWidth: px(200) }} />
        </Row>
        <Row icon={<MonitorSmartphone size={13} />} label="repository FE"
          hint={autoFe ? `automatico: ${autoFe}, associata a un'altra cartella di questo project` : "automatico: una repository associata a un'altra cartella di questo project"}>
          <RepoNameSelect repos={repos.filter(r => !(eff.be && sameName(r, eff.be)))} catalogRead={!!list?.ok} value={feValue} onChange={setFe}
            special={[
              { value: AUTO, label: autoFe ? `automatico (${autoFe})` : 'automatico (nessuna proposta)' },
              { value: NONE, label: 'nessun FE' }
            ]}
            title="repository del frontend" tip="saved for this project; never the same as the BE"
            style={{ minWidth: px(200) }} />
        </Row>
        <Row icon={<Link2 size={13} />} label="fase predefinita"
          hint="quella con cui si apre il pannello Rilascio; develop → qa → prod crea la PR qa → prod da sola appena la PR develop → qa è completata">
          <SelectInput value={config?.stage ?? 'dev-qa'} options={STAGE_OPTIONS} onChange={setStage}
            title="fase di rilascio predefinita" tip="saved for this project; the Release panel changes it too"
            style={{ minWidth: px(200) }} />
        </Row>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: px(10), fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            <Rocket size={11} />
            rilascio:
            {eff.be ? <Chip tone="accent">BE {eff.be}</Chip> : <Chip>BE dalla cartella aperta</Chip>}
            <ArrowRight size={10} />
            {eff.fe ? <Chip tone="accent">FE {eff.fe}</Chip> : <Chip>nessun FE</Chip>}
            {busy && <span>salvataggio…</span>}
          </div>
          {!list && catalogLoading && <Loading>lettura repository…</Loading>}
          {list && !list.ok && (
            <Notice tone="error" actions={
              <Btn onClick={() => onOpenPage('ado-connections')} title="connessioni" data-tip-desc="Azure DevOps › Connessioni">
                <Cloud size={11} /> connessioni
              </Btn>
            }>
              repository non lette: {list.error}. Le scelte salvate restano valide.
            </Notice>
          )}
          {overrides.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: px(9.5), fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              <GitBranch size={11} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>branch scelti a mano per {overrides.join(', ')}: si cambiano nel pannello Rilascio</span>
            </div>
          )}
        </CardBody>
      </Card>
    )
  }

  if (!api) return <Notice tone="warning">impostazioni Azure DevOps non disponibili in questa finestra</Notice>

  return (
    <>
      {!settings ? (
        <Card><Loading>lettura impostazioni…</Loading></Card>
      ) : connections.length === 0 ? (
        <Notice tone="warning" actions={
          <Btn variant="primary" onClick={() => onOpenPage('ado-connections')} title="aggiungi connessione" data-tip-desc="Azure DevOps › Connessioni">
            <Cloud size={11} /> configura una connessione
          </Btn>
        }>
          nessuna connessione Azure DevOps configurata: il rilascio usa la connessione della cartella aperta.
        </Notice>
      ) : (
        <>
          <Notice tone="info" icon={<Rocket size={12} />}>
            le stesse scelte del pannello Rilascio, per project: ogni modifica è salvata subito e vale per tutte le finestre e le istanze dell'IDE.
          </Notice>
          {ordered.map(renderConnection)}
        </>
      )}
    </>
  )
}
