import { useState } from 'react'
import { AlertCircle, Check, Cloud, ExternalLink, FolderGit2, KeyRound, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from '@/components/icons'
import { useAdoSettingsStore, useToastStore } from '../../../store'
import type { SettingsPageId } from '../../../store'
import { parseAdoUrl } from '../../../shared/adoSettings'
import type { AdoConnectionConfig, AdoRepoList } from '../../../shared/adoSettings'
import { tr, useI18n } from '../../../i18n'
import { Modal } from '../../layout/Modal'
import { Btn, Card, CardBody, Chip, FieldLabel, Loading, Notice, inputStyle, ipcMessage, px, spin } from '../ui'
import { connectionLabel, useCatalogOnMount } from './adoUi'

type Verification = AdoRepoList & { at?: number }

interface FormState {
  /** set when editing */
  id?: string
  organization: string
  project: string
  token: string
  saving: boolean
  error: string | null
}

const emptyForm = (): FormState => ({ organization: '', project: '', token: '', saving: false, error: null })

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function ConnectionsPage({ onOpenPage }: { onOpenPage: (page: SettingsPageId) => void }) {
  const t = useI18n()
  const settings = useAdoSettingsStore(s => s.settings)
  const catalog = useAdoSettingsStore(s => s.catalog)
  const catalogLoading = useAdoSettingsStore(s => s.catalogLoading)
  const showToast = useToastStore(s => s.showToast)
  const [checks, setChecks] = useState<Record<string, Verification>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState<FormState | null>(null)
  const [removeTarget, setRemoveTarget] = useState<AdoConnectionConfig | null>(null)
  const [removing, setRemoving] = useState(false)
  useCatalogOnMount()

  const api = window.electronAPI?.adoSettings
  const connections = settings?.connections ?? []
  // nothing configured yet: the add form is the page
  const showNewForm = !!settings && ((form && !form.id) || connections.length === 0)

  const verify = async (c: AdoConnectionConfig) => {
    setTesting(prev => ({ ...prev, [c.id]: true }))
    try {
      const res = await api.test(c.id)
      setChecks(prev => ({ ...prev, [c.id]: { ...res, at: Date.now() } }))
      if (res.ok) {
        showToast(res.repos.length === 1
          ? tr('{name}: 1 repository', { name: connectionLabel(c) })
          : tr('{name}: {n} repositories', { name: connectionLabel(c), n: res.repos.length }))
        // the main process cached the fresh list: the store follows for free
        void useAdoSettingsStore.getState().loadCatalog()
      } else showToast(res.error, 'error')
    } catch (e) {
      setChecks(prev => ({ ...prev, [c.id]: { ok: false, error: ipcMessage(e, tr('verification failed')), at: Date.now() } }))
    } finally {
      setTesting(prev => ({ ...prev, [c.id]: false }))
    }
  }

  const setField = (field: 'organization' | 'project' | 'token', value: string) => {
    setForm(f => {
      const base = f ?? emptyForm()
      if (field === 'organization') {
        const parsed = parseAdoUrl(value)
        if (parsed) return { ...base, organization: parsed.organization, project: parsed.project ?? base.project, error: null }
      }
      return { ...base, [field]: value, error: null }
    })
  }

  const save = async () => {
    const f = form ?? emptyForm()
    const organization = f.organization.trim()
    const project = f.project.trim()
    const token = f.token.trim()
    if (!organization || !project) { setForm({ ...f, error: t('organization and project are required') }); return }
    if (!f.id && !token) { setForm({ ...f, error: t('paste the PAT: it is required for a new connection') }); return }
    setForm({ ...f, saving: true, error: null })
    try {
      const { connection, repos } = await api.saveConnection({ id: f.id, organization, project, token: token || undefined })
      setChecks(prev => ({ ...prev, [connection.id]: { ok: true, repos, at: Date.now() } }))
      setForm(null)
      showToast(repos.length === 1
        ? tr('{name} saved: 1 repository', { name: connectionLabel(connection) })
        : tr('{name} saved: {n} repositories', { name: connectionLabel(connection), n: repos.length }))
      await useAdoSettingsStore.getState().load()
    } catch (e) {
      setForm(cur => ({ ...(cur ?? f), saving: false, error: ipcMessage(e, tr('save failed')) }))
    }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      await api.removeConnection(removeTarget.id)
      showToast(tr('connection {name} removed', { name: connectionLabel(removeTarget) }))
      setChecks(prev => { const next = { ...prev }; delete next[removeTarget.id]; return next })
      if (form?.id === removeTarget.id) setForm(null)
      setRemoveTarget(null)
      await useAdoSettingsStore.getState().load()
    } catch (e) {
      showToast(ipcMessage(e, tr('removal failed')), 'error')
    } finally {
      setRemoving(false)
    }
  }

  const foldersOf = (id: string) => Object.values(settings?.folders ?? {}).filter(r => r.connectionId === id).length

  const renderForm = (f: FormState | null) => {
    const cur = f ?? emptyForm()
    const editing = !!cur.id
    const org = cur.organization.trim()
    const canSave = !cur.saving && !!org && !!cur.project.trim() && (editing || !!cur.token.trim())
    const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && canSave) void save() }
    return (
      <Card
        key={cur.id ?? 'new'}
        accent
        title={editing ? t('Edit {name}', { name: connectionLabel({ organization: cur.organization || '…', project: cur.project || '…' }) }) : t('Add connection')}
        icon={editing ? <Pencil size={12} /> : <Plus size={12} />}
        description={t('saved only if Azure DevOps answers with these details')}
      >
        <CardBody gap={10}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <FieldLabel grow label="Organization" hint={t('dev.azure.com/«organization» — you can paste the project URL')}>
              <input value={cur.organization} onChange={(e) => setField('organization', e.target.value)} onKeyDown={onEnter}
                placeholder="contoso" spellCheck={false} autoComplete="off"
                title={t('Azure DevOps organization')} data-tip-desc={t('the name after dev.azure.com/, or paste the whole project URL')}
                style={inputStyle} />
            </FieldLabel>
            <FieldLabel grow label="Project">
              <input value={cur.project} onChange={(e) => setField('project', e.target.value)} onKeyDown={onEnter}
                placeholder="Themis" spellCheck={false} autoComplete="off"
                title={t('Azure DevOps project')} data-tip-desc={t('the project that holds the repositories')}
                style={inputStyle} />
            </FieldLabel>
          </div>
          <FieldLabel label="Personal Access Token"
            hint={<>scope: <b>Code (Read &amp; Write)</b> {t('for pull requests,')} <b>Work Items (Read)</b> {t('for PBIs')}</>}>
            <input type="password" value={cur.token} onChange={(e) => setField('token', e.target.value)} onKeyDown={onEnter}
              placeholder={editing ? t('PAT saved — paste to replace it') : t('paste the PAT')}
              autoComplete="new-password" spellCheck={false}
              title={t('Azure DevOps PAT')} data-tip-desc={t('write-only: it is encrypted by the system keystore and never shown again')}
              style={inputStyle} />
          </FieldLabel>
          {cur.error && <Notice tone="error">{cur.error}</Notice>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <Btn variant="primary" onClick={() => { void save() }} disabled={!canSave}
              title={t('verify and save')} data-tip-desc={t("reads the project's repositories with this PAT: saved only when Azure DevOps answers")}>
              {cur.saving ? <Loader2 size={11} style={spin} /> : <ShieldCheck size={11} />}
              {cur.saving ? t('verifying…') : t('verify and save')}
            </Btn>
            {(editing || connections.length > 0) && (
              <Btn onClick={() => setForm(null)} disabled={cur.saving}>{t('cancel')}</Btn>
            )}
            {org && (
              <Btn variant="subtle" style={{ marginLeft: 'auto' }}
                onClick={() => { void window.electronAPI.shell.openExternal(`https://dev.azure.com/${encodeURIComponent(org)}/_usersSettings/tokens`).catch(() => {}) }}
                title={t('create a PAT on Azure DevOps')} data-tip-desc={t('opens the Personal Access Tokens page of this organization in the browser')}>
                <ExternalLink size={11} /> {t('create a PAT')}
              </Btn>
            )}
          </div>
        </CardBody>
      </Card>
    )
  }

  const renderConnection = (c: AdoConnectionConfig) => {
    if (form?.id === c.id) return renderForm(form)
    const hasToken = !!settings?.tokens[c.id]
    const result: Verification | undefined = checks[c.id] ?? catalog[c.id]
    const busy = !!testing[c.id]
    const folders = foldersOf(c.id)
    return (
      <Card
        key={c.id}
        title={<><span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{c.organization} /</span> {c.project}</>}
        icon={<Cloud size={12} />}
        actions={
          <>
            <Btn onClick={() => { void verify(c) }} disabled={busy || !hasToken}
              title={t('verify the connection')} data-tip-desc={t('reads the repository list with the saved PAT')}>
              {busy ? <Loader2 size={11} style={spin} /> : <RefreshCw size={11} />} {t('verify')}
            </Btn>
            <Btn onClick={() => setForm({ ...emptyForm(), id: c.id, organization: c.organization, project: c.project })}
              title={t('edit the connection')} data-tip-desc={t('change organization, project or replace the PAT')}>
              <Pencil size={11} /> {t('edit')}
            </Btn>
            <Btn variant="danger" onClick={() => setRemoveTarget(c)}
              title={t('remove the connection')} data-tip-desc={t('forgets the PAT and the folders that use this connection (asks first)')}>
              <Trash2 size={11} /> {t('remove')}
            </Btn>
          </>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', padding: '9px 12px' }}>
          {hasToken
            ? <Chip tone="success" icon={<KeyRound size={9} />} title={t('PAT saved')} tip={t('encrypted by the system keystore')}>{t('PAT saved')}</Chip>
            : <Chip tone="warning" icon={<KeyRound size={9} />} title={t('PAT missing')} tip={t('use «edit» to paste it again')}>{t('PAT missing')}</Chip>}
          {folders > 0 && (
            <Chip icon={<FolderGit2 size={9} />} title={folders === 1 ? t('1 folder uses this connection') : t('{n} folders use this connection', { n: folders })} tip={t('see Repositories by folder')}>
              {folders === 1 ? t('1 folder') : t('{n} folders', { n: folders })}
            </Chip>
          )}
          <span style={{ flex: '1 1 160px', minWidth: 0, fontSize: px(10), fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'flex-start', gap: '5px', justifyContent: 'flex-end', textAlign: 'right' }}>
            {busy ? (
              <span style={{ color: 'var(--text-muted)' }}>{t('verifying…')}</span>
            ) : !hasToken ? (
              <span style={{ color: 'var(--warning-color)' }}>{t('paste the PAT with «edit» to use this connection')}</span>
            ) : result ? (
              result.ok ? (
                <span style={{ color: 'var(--success-color)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Check size={11} /> {result.repos.length === 1 ? t('1 repository') : t('{n} repositories', { n: result.repos.length })}
                  {result.at && <span style={{ color: 'var(--text-muted)' }}>· {t('verified at {time}', { time: time(result.at) })}</span>}
                </span>
              ) : (
                <span style={{ color: 'var(--error-color)', display: 'inline-flex', alignItems: 'flex-start', gap: '4px', wordBreak: 'break-word' }}>
                  <AlertCircle size={11} style={{ flexShrink: 0, marginTop: '2px' }} /> {result.error}
                </span>
              )
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>{catalogLoading ? t('reading repositories…') : t('not verified yet')}</span>
            )}
          </span>
        </div>
      </Card>
    )
  }

  if (!api) return <Notice tone="warning">{t('Azure DevOps settings not available in this window')}</Notice>

  return (
    <>
      {!settings ? (
        <Card><Loading>{t('reading settings…')}</Loading></Card>
      ) : (
        <>
          {connections.map(renderConnection)}
          {showNewForm ? renderForm(form && !form.id ? form : null) : (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <Btn variant="primary" onClick={() => setForm(emptyForm())} disabled={!!form}
                title={t('add connection')} data-tip-desc={t('another organization or project: each one has its own PAT')}>
                <Plus size={11} /> {t('add connection')}
              </Btn>
              {connections.length > 0 && (
                <Btn onClick={() => onOpenPage('ado-folders')} title={t('repository per folder')} data-tip-desc={t('which repository each local folder uses')}>
                  <FolderGit2 size={11} /> {t('repository per folder')}
                </Btn>
              )}
            </div>
          )}
        </>
      )}

      <Notice tone="info" icon={<ShieldCheck size={12} />}>
        {t('the PAT is encrypted by the system keystore and never leaves the main process: here you only see whether it is saved.')}
        {' '}{t('It needs the scopes')} <b>Code (Read &amp; Write)</b> {t('for pull requests and')} <b>Work Items (Read)</b> {t('for PBIs.')}
        {' '}{t('Connections are shared by every window and instance of the IDE.')}
      </Notice>

      {removeTarget && (
        <Modal onClose={() => { if (!removing) setRemoveTarget(null) }} width={440} label={t('remove connection')}>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trash2 size={15} style={{ color: 'var(--error-color)', flexShrink: 0 }} />
              <span style={{ fontSize: px(13), fontWeight: 700, color: 'var(--text-primary)' }}>
                {t('remove {name}', { name: connectionLabel(removeTarget) })}
              </span>
            </div>
            <div style={{ fontSize: px(11), color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {foldersOf(removeTarget.id) === 0
                ? t('the saved PAT is deleted.')
                : foldersOf(removeTarget.id) === 1
                  ? t('the saved PAT is deleted and the folder that uses it goes back to no repository.')
                  : t('the saved PAT is deleted and the {n} folders that use it go back to no repository.', { n: foldersOf(removeTarget.id) })}
              {' '}{t('The release choices of this project stay saved: they apply again if you add it back.')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Btn onClick={() => setRemoveTarget(null)} disabled={removing}>{t('cancel')}</Btn>
              <Btn variant="primary" onClick={() => { void confirmRemove() }} disabled={removing}
                style={{ background: 'var(--error-color)' }}>
                {removing ? <Loader2 size={11} style={spin} /> : <Trash2 size={11} />} {t('remove')}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
