import { useState } from 'react'
import { AlertCircle, Check, Cloud, ExternalLink, FolderGit2, KeyRound, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from '@/components/icons'
import { useAdoSettingsStore, useToastStore } from '../../../store'
import type { SettingsPageId } from '../../../store'
import { parseAdoUrl } from '../../../shared/adoSettings'
import type { AdoConnectionConfig, AdoRepoList } from '../../../shared/adoSettings'
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
        showToast(`${connectionLabel(c)}: ${res.repos.length} repository`)
        // the main process cached the fresh list: the store follows for free
        void useAdoSettingsStore.getState().loadCatalog()
      } else showToast(res.error, 'error')
    } catch (e) {
      setChecks(prev => ({ ...prev, [c.id]: { ok: false, error: ipcMessage(e, 'verifica fallita'), at: Date.now() } }))
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
    if (!organization || !project) { setForm({ ...f, error: 'organization e project sono obbligatori' }); return }
    if (!f.id && !token) { setForm({ ...f, error: 'incolla il PAT: è obbligatorio per una nuova connessione' }); return }
    setForm({ ...f, saving: true, error: null })
    try {
      const { connection, repos } = await api.saveConnection({ id: f.id, organization, project, token: token || undefined })
      setChecks(prev => ({ ...prev, [connection.id]: { ok: true, repos, at: Date.now() } }))
      setForm(null)
      showToast(`${connectionLabel(connection)} salvata: ${repos.length} repository`)
      await useAdoSettingsStore.getState().load()
    } catch (e) {
      setForm(cur => ({ ...(cur ?? f), saving: false, error: ipcMessage(e, 'salvataggio fallito') }))
    }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      await api.removeConnection(removeTarget.id)
      showToast(`connessione ${connectionLabel(removeTarget)} rimossa`)
      setChecks(prev => { const next = { ...prev }; delete next[removeTarget.id]; return next })
      if (form?.id === removeTarget.id) setForm(null)
      setRemoveTarget(null)
      await useAdoSettingsStore.getState().load()
    } catch (e) {
      showToast(ipcMessage(e, 'rimozione fallita'), 'error')
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
        title={editing ? `Modifica ${connectionLabel({ organization: cur.organization || '…', project: cur.project || '…' })}` : 'Aggiungi connessione'}
        icon={editing ? <Pencil size={12} /> : <Plus size={12} />}
        description="viene salvata solo se Azure DevOps risponde con questi dati"
      >
        <CardBody gap={10}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <FieldLabel grow label="Organization" hint="dev.azure.com/«organization» — puoi incollare l'URL del progetto">
              <input value={cur.organization} onChange={(e) => setField('organization', e.target.value)} onKeyDown={onEnter}
                placeholder="contoso" spellCheck={false} autoComplete="off"
                title="organization di Azure DevOps" data-tip-desc="the name after dev.azure.com/, or paste the whole project URL"
                style={inputStyle} />
            </FieldLabel>
            <FieldLabel grow label="Project">
              <input value={cur.project} onChange={(e) => setField('project', e.target.value)} onKeyDown={onEnter}
                placeholder="Themis" spellCheck={false} autoComplete="off"
                title="project di Azure DevOps" data-tip-desc="the project that holds the repositories"
                style={inputStyle} />
            </FieldLabel>
          </div>
          <FieldLabel label="Personal Access Token"
            hint={<>scope: <b>Code (Read &amp; Write)</b> per le pull request, <b>Work Items (Read)</b> per i PBI</>}>
            <input type="password" value={cur.token} onChange={(e) => setField('token', e.target.value)} onKeyDown={onEnter}
              placeholder={editing ? 'PAT salvato — incolla per sostituirlo' : 'incolla il PAT'}
              autoComplete="new-password" spellCheck={false}
              title="PAT di Azure DevOps" data-tip-desc="write-only: it is encrypted by the system keystore and never shown again"
              style={inputStyle} />
          </FieldLabel>
          {cur.error && <Notice tone="error">{cur.error}</Notice>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <Btn variant="primary" onClick={() => { void save() }} disabled={!canSave}
              title="verifica e salva" data-tip-desc="reads the project's repositories with this PAT: saved only when Azure DevOps answers">
              {cur.saving ? <Loader2 size={11} style={spin} /> : <ShieldCheck size={11} />}
              {cur.saving ? 'verifica in corso…' : 'verifica e salva'}
            </Btn>
            {(editing || connections.length > 0) && (
              <Btn onClick={() => setForm(null)} disabled={cur.saving}>annulla</Btn>
            )}
            {org && (
              <Btn variant="subtle" style={{ marginLeft: 'auto' }}
                onClick={() => { void window.electronAPI.shell.openExternal(`https://dev.azure.com/${encodeURIComponent(org)}/_usersSettings/tokens`).catch(() => {}) }}
                title="crea un PAT su Azure DevOps" data-tip-desc="opens the Personal Access Tokens page of this organization in the browser">
                <ExternalLink size={11} /> crea un PAT
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
              title="verifica la connessione" data-tip-desc="reads the repository list with the saved PAT">
              {busy ? <Loader2 size={11} style={spin} /> : <RefreshCw size={11} />} verifica
            </Btn>
            <Btn onClick={() => setForm({ ...emptyForm(), id: c.id, organization: c.organization, project: c.project })}
              title="modifica la connessione" data-tip-desc="change organization, project or replace the PAT">
              <Pencil size={11} /> modifica
            </Btn>
            <Btn variant="danger" onClick={() => setRemoveTarget(c)}
              title="rimuovi la connessione" data-tip-desc="forgets the PAT and the folders that use this connection (asks first)">
              <Trash2 size={11} /> rimuovi
            </Btn>
          </>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', padding: '9px 12px' }}>
          {hasToken
            ? <Chip tone="success" icon={<KeyRound size={9} />} title="PAT salvato" tip="encrypted by the system keystore">PAT salvato</Chip>
            : <Chip tone="warning" icon={<KeyRound size={9} />} title="PAT mancante" tip="use 'modifica' to paste it again">PAT mancante</Chip>}
          {folders > 0 && (
            <Chip icon={<FolderGit2 size={9} />} title={`${folders} cartelle usano questa connessione`} tip="see Repository per cartella">
              {folders === 1 ? '1 cartella' : `${folders} cartelle`}
            </Chip>
          )}
          <span style={{ flex: '1 1 160px', minWidth: 0, fontSize: px(10), fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'flex-start', gap: '5px', justifyContent: 'flex-end', textAlign: 'right' }}>
            {busy ? (
              <span style={{ color: 'var(--text-muted)' }}>verifica in corso…</span>
            ) : !hasToken ? (
              <span style={{ color: 'var(--warning-color)' }}>incolla il PAT con «modifica» per usare questa connessione</span>
            ) : result ? (
              result.ok ? (
                <span style={{ color: 'var(--success-color)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Check size={11} /> {result.repos.length === 1 ? '1 repository' : `${result.repos.length} repository`}
                  {result.at && <span style={{ color: 'var(--text-muted)' }}>· verificata alle {time(result.at)}</span>}
                </span>
              ) : (
                <span style={{ color: 'var(--error-color)', display: 'inline-flex', alignItems: 'flex-start', gap: '4px', wordBreak: 'break-word' }}>
                  <AlertCircle size={11} style={{ flexShrink: 0, marginTop: '2px' }} /> {result.error}
                </span>
              )
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>{catalogLoading ? 'lettura repository…' : 'non ancora verificata'}</span>
            )}
          </span>
        </div>
      </Card>
    )
  }

  if (!api) return <Notice tone="warning">impostazioni Azure DevOps non disponibili in questa finestra</Notice>

  return (
    <>
      {!settings ? (
        <Card><Loading>lettura impostazioni…</Loading></Card>
      ) : (
        <>
          {connections.map(renderConnection)}
          {showNewForm ? renderForm(form && !form.id ? form : null) : (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <Btn variant="primary" onClick={() => setForm(emptyForm())} disabled={!!form}
                title="aggiungi connessione" data-tip-desc="another organization or project: each one has its own PAT">
                <Plus size={11} /> aggiungi connessione
              </Btn>
              {connections.length > 0 && (
                <Btn onClick={() => onOpenPage('ado-folders')} title="repository per cartella" data-tip-desc="which repository each local folder uses">
                  <FolderGit2 size={11} /> repository per cartella
                </Btn>
              )}
            </div>
          )}
        </>
      )}

      <Notice tone="info" icon={<ShieldCheck size={12} />}>
        il PAT è cifrato dal keystore di sistema e non lascia mai il processo principale: qui si vede solo se è salvato.
        Servono gli scope <b>Code (Read &amp; Write)</b> per le pull request e <b>Work Items (Read)</b> per i PBI.
        Le connessioni sono condivise da tutte le finestre e le istanze dell'IDE.
      </Notice>

      {removeTarget && (
        <Modal onClose={() => { if (!removing) setRemoveTarget(null) }} width={440} label="rimuovi connessione">
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trash2 size={15} style={{ color: 'var(--error-color)', flexShrink: 0 }} />
              <span style={{ fontSize: px(13), fontWeight: 700, color: 'var(--text-primary)' }}>
                rimuovi {connectionLabel(removeTarget)}
              </span>
            </div>
            <div style={{ fontSize: px(11), color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              il PAT salvato viene cancellato
              {foldersOf(removeTarget.id) > 0
                ? ` e ${foldersOf(removeTarget.id) === 1 ? "la cartella che la usa torna" : `le ${foldersOf(removeTarget.id)} cartelle che la usano tornano`} senza repository`
                : ''}.
              {' '}Le scelte di rilascio di questo project restano salvate: valgono di nuovo se la riaggiungi.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Btn onClick={() => setRemoveTarget(null)} disabled={removing}>annulla</Btn>
              <Btn variant="primary" onClick={() => { void confirmRemove() }} disabled={removing}
                style={{ background: 'var(--error-color)' }}>
                {removing ? <Loader2 size={11} style={spin} /> : <Trash2 size={11} />} rimuovi
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
