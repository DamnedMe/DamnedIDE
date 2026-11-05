import { useEffect, useState } from 'react'
import { AlertCircle, Check, Copy, Download, Languages, Loader2, RefreshCw, RotateCw } from '@/components/icons'
import { useSettingsStore, useToastStore } from '../../../store'
import { useI18n } from '../../../i18n'
import { Btn, Card, CardBody, Notice, PathText, Row, SelectInput, ipcMessage, px, spin } from '../ui'

// ─── Aggiornamenti: current version, manual check, one-click install of the latest ─

function updateStatusText(st: UpdateState | null): string {
  if (!st) return '…'
  if (!st.packaged) return "versione di sviluppo: gli aggiornamenti OTA sono attivi solo nell'app installata"
  if (st.pendingRestart) return `versione ${st.pendingRestart} installata — riavvia DamnedIDE per usarla`
  const failed = st.error ? 'aggiornamento non riuscito — dettagli qui sotto' : 'verifica non riuscita'
  // managed (deb/pacman/rpm): the IDE downloads the distro package and installs it
  // with pkexec; when the feed has no package it points at the package manager
  if (st.managed) {
    switch (st.status) {
      case 'idle': return `versione installata ${st.currentVersion}`
      case 'checking': return 'verifica in corso…'
      case 'available': return st.selfInstall === false
        ? `nuova versione ${st.version} disponibile — ${st.installHint || 'aggiorna con il gestore pacchetti'}`
        : `nuova versione ${st.version} disponibile — scaricamento in corso…`
      case 'downloading': return `scaricamento ${st.version ?? ''}… ${st.progress ?? 0}%`
      case 'downloaded': return `versione ${st.version} scaricata, pronta da installare`
      case 'installing': return 'installazione in corso (pkexec chiede la password)…'
      case 'up-to-date': return `sei alla versione più recente (${st.currentVersion})`
      case 'error': return failed
      default: break
    }
  }
  switch (st.status) {
    case 'idle': return `versione installata ${st.currentVersion}`
    case 'checking': return 'verifica in corso…'
    case 'available': return `nuova versione ${st.version} disponibile — scaricamento in corso…`
    case 'downloading': return `scaricamento ${st.version ?? ''}… ${st.progress ?? 0}%`
    case 'downloaded': return `versione ${st.version} pronta — installala ora o alla chiusura di DamnedIDE`
    case 'installing': return 'installazione in corso: DamnedIDE si chiude e si riapre…'
    case 'up-to-date': return `sei alla versione più recente (${st.currentVersion})`
    case 'error': return failed
  }
}

function updateCardDescription(st: UpdateState | null): string {
  if (st?.managed) {
    return 'le nuove versioni arrivano dalle release GitHub: DamnedIDE scarica il pacchetto e lo installa con il gestore pacchetti (pkexec chiede la password di amministratore), poi va riavviato'
  }
  return 'le nuove versioni arrivano dalle release GitHub: si scaricano da sole e si installano con un clic o alla chiusura di DamnedIDE'
}

/** `update` is owned by the settings panel (the nav shows a dot when a version is ready). */
export function UpdatesPage({ update, setUpdate }: { update: UpdateState | null; setUpdate: (st: UpdateState) => void }) {
  const showToast = useToastStore(s => s.showToast)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [installingLatest, setInstallingLatest] = useState(false)
  // failure of the last "installa" click that the main state does not carry (another owner, IPC)
  const [installError, setInstallError] = useState<string | null>(null)
  // the main state moved on (re-download, new check, install): the old click error is stale
  // (the "another window" error keeps the same status, so it stays)
  useEffect(() => { setInstallError(null) }, [update?.status])

  const refresh = () => { window.electronAPI.updater.state().then(setUpdate).catch(() => { /* main not ready */ }) }

  const checkUpdates = async () => {
    setCheckingUpdates(true)
    setInstallError(null)
    try {
      const st = await window.electronAPI.updater.check()
      setUpdate(st)
      if (!st.packaged) showToast('gli aggiornamenti OTA valgono solo per la versione installata', 'info')
      else if (st.ownerElsewhere) showToast("un'altra finestra di DamnedIDE gestisce gli aggiornamenti", 'info')
      else if (st.status === 'up-to-date') showToast('sei già alla versione più recente')
      else if (st.status === 'error') showToast(st.error || 'verifica aggiornamenti fallita', 'error')
      else if (st.status === 'available') {
        showToast(st.managed && st.selfInstall === false
          ? `nuova versione ${st.version} disponibile — ${st.installHint || 'aggiorna con il gestore pacchetti'}`
          : `nuova versione ${st.version} in scaricamento`)
      }
    } catch (e) {
      showToast(ipcMessage(e, 'verifica aggiornamenti fallita'), 'error')
    } finally {
      setCheckingUpdates(false)
    }
  }

  // one click: download if needed, then install (Windows/macOS: DamnedIDE closes and
  // the installer runs; managed Linux: pkexec, then "riavvia ora")
  const installLatest = async () => {
    setInstallingLatest(true)
    setInstallError(null)
    try {
      const res = await window.electronAPI.updater.installLatest()
      if (!res.ok) {
        setInstallError(res.error || 'installazione aggiornamento fallita')
        showToast(res.error || 'installazione aggiornamento fallita', 'error')
      } else if (res.upToDate) showToast('sei già alla versione più recente')
      else if (res.restartRequired) showToast('aggiornamento installato: riavvia DamnedIDE')
    } catch (e) {
      const message = ipcMessage(e, 'installazione aggiornamento fallita')
      setInstallError(message)
      showToast(message, 'error')
    } finally {
      setInstallingLatest(false)
      refresh()
    }
  }

  const restart = () => {
    window.electronAPI.updater.restart().catch(e => showToast(ipcMessage(e, 'riavvio non riuscito'), 'error'))
  }

  const copyLogPath = () => {
    if (!update?.logPath) return
    window.electronAPI.clipboard.write(update.logPath)
    showToast('percorso del log copiato')
  }

  const status = update?.status
  const working = status === 'checking' || status === 'downloading' || status === 'installing'
  const checkBusy = checkingUpdates || installingLatest || working
  // a newer version is known and the IDE can install it itself
  const canInstall = !!update && update.packaged && !update.ownerElsewhere && !update.pendingRestart && !!update.version
    && !(update.managed && update.selfInstall === false)
    && (status === 'available' || status === 'downloading' || status === 'downloaded' || status === 'installing' || status === 'error')
  const installBusy = installingLatest || status === 'installing' || status === 'checking' || checkingUpdates
  const errorText = installError || update?.error || null
  const statusColor =
    status === 'up-to-date' || status === 'downloaded' || update?.pendingRestart ? 'var(--success-color)'
      : status === 'error' ? 'var(--error-color)'
        : 'var(--text-muted)'
  const progress = status === 'downloading' ? Math.max(0, Math.min(100, update?.progress ?? 0)) : null

  return (
    <Card title="DamnedIDE" icon={<RefreshCw size={12} />} description={updateCardDescription(update)}>
      <Row
        icon={
          <span style={{ display: 'flex', color: statusColor }}>
            {working || checkingUpdates || installingLatest
              ? <Loader2 size={14} style={spin} />
              : status === 'error' ? <AlertCircle size={14} />
                : status === 'up-to-date' || status === 'downloaded' || update?.pendingRestart ? <Check size={14} />
                  : <RefreshCw size={14} />}
          </span>
        }
        label={<>versione {update?.currentVersion || '…'}</>}
        hint={<span style={{ color: statusColor }}>{updateStatusText(update)}</span>}
      >
        <Btn onClick={checkUpdates} disabled={checkBusy}
          title={update?.ownerElsewhere
            ? "verifica la disponibilità di aggiornamenti (subentra se l'altra finestra di DamnedIDE è stata chiusa)"
            : 'verifica la disponibilità di aggiornamenti'}
          data-tip-desc="check GitHub releases for a newer version">
          {checkingUpdates ? <Loader2 size={11} style={spin} /> : <RefreshCw size={11} />}
          verifica aggiornamenti
        </Btn>
        {canInstall && (
          <Btn variant="primary" onClick={installLatest} disabled={installBusy}
            title={update?.managed
              ? `installa la versione ${update.version} con il gestore pacchetti (pkexec chiede la password di amministratore)`
              : `installa la versione ${update?.version}: DamnedIDE si chiude, si aggiorna e si riapre`}
            data-tip-desc="downloads the update when needed, then installs it">
            {installBusy ? <Loader2 size={11} style={spin} /> : <Download size={11} />}
            installa la versione {update?.version}
          </Btn>
        )}
        {update?.pendingRestart && (
          <Btn variant="primary" onClick={restart}
            title={`riavvia DamnedIDE con la versione ${update.pendingRestart}`} data-tip-desc="relaunch the IDE on the installed version">
            <RotateCw size={11} />
            riavvia ora
          </Btn>
        )}
      </Row>
      {progress !== null && (
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ height: '4px', borderRadius: '2px', background: 'var(--bg-disabled)', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent-color)', transition: 'width 0.3s ease' }} />
          </div>
        </div>
      )}
      {update?.ownerElsewhere && (
        <div style={{ padding: '8px 12px', fontSize: px(9.5), color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
          un'altra finestra di DamnedIDE gestisce gli aggiornamenti
        </div>
      )}
      {update?.pendingRestart && (
        <CardBody>
          <Notice tone="info">
            chiudi anche le altre finestre di DamnedIDE: usano ancora la versione precedente
          </Notice>
        </CardBody>
      )}
      {errorText && (
        <CardBody>
          <Notice tone="error" actions={update?.logPath ? (
            <Btn onClick={copyLogPath} title="copia il percorso del log aggiornamenti" data-tip-desc="updater.log: checks, downloads, install command and output">
              <Copy size={11} />
              copia percorso
            </Btn>
          ) : undefined}>
            {errorText}
            {update?.logPath && (
              <div style={{ marginTop: '4px' }}>
                log: <PathText muted>{update.logPath}</PathText>
              </div>
            )}
          </Notice>
        </CardBody>
      )}
    </Card>
  )
}

// ─── Lingua ───

export function LanguagePage() {
  const language = useSettingsStore(s => s.settings.language)
  const updateSettings = useSettingsStore(s => s.updateSettings)
  const t = useI18n()
  return (
    <Card>
      <Row icon={<Languages size={13} />} label={t('language')}
        hint="le etichette tradotte seguono la lingua scelta; i messaggi dell'IDE restano in italiano">
        <SelectInput value={language} onChange={(v) => updateSettings({ language: v as 'en' | 'it' })}
          title="lingua dell'interfaccia" tip="applied at once to the translated labels"
          options={[
            { value: 'en', label: 'English' },
            { value: 'it', label: 'Italiano' }
          ]} />
      </Row>
    </Card>
  )
}
