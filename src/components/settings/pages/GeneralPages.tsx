import { useEffect, useState } from 'react'
import { AlertCircle, Check, Copy, Download, Languages, Loader2, RefreshCw, RotateCw } from '@/components/icons'
import { useSettingsStore, useToastStore } from '../../../store'
import { tr, useI18n } from '../../../i18n'
import { Btn, Card, CardBody, Notice, PathText, Row, SelectInput, ipcMessage, px, spin } from '../ui'

// ─── Aggiornamenti: current version, manual check, one-click install of the latest ─

function updateStatusText(st: UpdateState | null): string {
  if (!st) return '…'
  if (!st.packaged) return tr('development build: OTA updates are active only in the installed app')
  if (st.pendingRestart) return tr('version {v} installed — restart DamnedIDE to use it', { v: st.pendingRestart })
  const failed = st.error ? tr('update failed — details below') : tr('check failed')
  // managed (deb/pacman/rpm): the IDE downloads the distro package and installs it
  // with pkexec; when the feed has no package it points at the package manager
  if (st.managed) {
    switch (st.status) {
      case 'idle': return tr('installed version {v}', { v: st.currentVersion })
      case 'checking': return tr('checking…')
      case 'available': return st.selfInstall === false
        ? tr('new version {v} available — {hint}', { v: st.version ?? '', hint: st.installHint || tr('update with the package manager') })
        : tr('new version {v} available — downloading…', { v: st.version ?? '' })
      case 'downloading': return tr('downloading {v}… {p}%', { v: st.version ?? '', p: st.progress ?? 0 })
      case 'downloaded': return tr('version {v} downloaded, ready to install', { v: st.version ?? '' })
      case 'installing': return tr('installing (pkexec asks for the password)…')
      case 'up-to-date': return tr('you are on the latest version ({v})', { v: st.currentVersion })
      case 'error': return failed
      default: break
    }
  }
  switch (st.status) {
    case 'idle': return tr('installed version {v}', { v: st.currentVersion })
    case 'checking': return tr('checking…')
    case 'available': return tr('new version {v} available — downloading…', { v: st.version ?? '' })
    case 'downloading': return tr('downloading {v}… {p}%', { v: st.version ?? '', p: st.progress ?? 0 })
    case 'downloaded': return tr('version {v} ready — install it now or when DamnedIDE closes', { v: st.version ?? '' })
    case 'installing': return tr('installing: DamnedIDE closes and reopens…')
    case 'up-to-date': return tr('you are on the latest version ({v})', { v: st.currentVersion })
    case 'error': return failed
  }
}

function updateCardDescription(st: UpdateState | null): string {
  if (st?.managed) {
    return tr('new versions come from the GitHub releases: DamnedIDE downloads the package and installs it with the package manager (pkexec asks for the administrator password), then it needs a restart')
  }
  return tr('new versions come from the GitHub releases: they download by themselves and install with one click or when DamnedIDE closes')
}

/** `update` is owned by the settings panel (the nav shows a dot when a version is ready). */
export function UpdatesPage({ update, setUpdate }: { update: UpdateState | null; setUpdate: (st: UpdateState) => void }) {
  // re-renders on a language change (the helpers above use tr)
  const t = useI18n()
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
      if (!st.packaged) showToast(tr('OTA updates apply only to the installed version'), 'info')
      else if (st.ownerElsewhere) showToast(tr('another DamnedIDE window handles the updates'), 'info')
      else if (st.status === 'up-to-date') showToast(tr('you are already on the latest version'))
      else if (st.status === 'error') showToast(st.error || tr('update check failed'), 'error')
      else if (st.status === 'available') {
        showToast(st.managed && st.selfInstall === false
          ? tr('new version {v} available — {hint}', { v: st.version ?? '', hint: st.installHint || tr('update with the package manager') })
          : tr('new version {v} downloading', { v: st.version ?? '' }))
      }
    } catch (e) {
      showToast(ipcMessage(e, tr('update check failed')), 'error')
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
        setInstallError(res.error || tr('update install failed'))
        showToast(res.error || tr('update install failed'), 'error')
      } else if (res.upToDate) showToast(tr('you are already on the latest version'))
      else if (res.restartRequired) showToast(tr('update installed: restart DamnedIDE'))
    } catch (e) {
      const message = ipcMessage(e, tr('update install failed'))
      setInstallError(message)
      showToast(message, 'error')
    } finally {
      setInstallingLatest(false)
      refresh()
    }
  }

  const restart = () => {
    window.electronAPI.updater.restart().catch(e => showToast(ipcMessage(e, tr('restart failed')), 'error'))
  }

  const copyLogPath = () => {
    if (!update?.logPath) return
    window.electronAPI.clipboard.write(update.logPath)
    showToast(t('log path copied'))
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
        label={<>{t('version {v}', { v: update?.currentVersion || '…' })}</>}
        hint={<span style={{ color: statusColor }}>{updateStatusText(update)}</span>}
      >
        <Btn onClick={checkUpdates} disabled={checkBusy}
          title={update?.ownerElsewhere
            ? t('check whether updates are available (takes over if the other DamnedIDE window was closed)')
            : t('check whether updates are available')}
          data-tip-desc={t('check GitHub releases for a newer version')}>
          {checkingUpdates ? <Loader2 size={11} style={spin} /> : <RefreshCw size={11} />}
          {t('check for updates')}
        </Btn>
        {canInstall && (
          <Btn variant="primary" onClick={installLatest} disabled={installBusy}
            title={update?.managed
              ? t('install version {v} with the package manager (pkexec asks for the administrator password)', { v: update.version ?? '' })
              : t('install version {v}: DamnedIDE closes, updates and reopens', { v: update?.version ?? '' })}
            data-tip-desc={t('downloads the update when needed, then installs it')}>
            {installBusy ? <Loader2 size={11} style={spin} /> : <Download size={11} />}
            {t('install version {v}', { v: update?.version ?? '' })}
          </Btn>
        )}
        {update?.pendingRestart && (
          <Btn variant="primary" onClick={restart}
            title={t('restart DamnedIDE on version {v}', { v: update.pendingRestart })} data-tip-desc={t('relaunch the IDE on the installed version')}>
            <RotateCw size={11} />
            {t('restart now')}
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
          {t('another DamnedIDE window handles the updates')}
        </div>
      )}
      {update?.pendingRestart && (
        <CardBody>
          <Notice tone="info">
            {t('close the other DamnedIDE windows too: they still use the previous version')}
          </Notice>
        </CardBody>
      )}
      {errorText && (
        <CardBody>
          <Notice tone="error" actions={update?.logPath ? (
            <Btn onClick={copyLogPath} title={t('copy the update log path')} data-tip-desc={t('updater.log: checks, downloads, install command and output')}>
              <Copy size={11} />
              {t('copy path')}
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
        hint={t('the interface follows the chosen language; some system messages stay in Italian')}>
        <SelectInput value={language} onChange={(v) => updateSettings({ language: v as 'en' | 'it' })}
          title={t('interface language')} tip={t('applied at once to the translated labels')}
          options={[
            { value: 'en', label: 'English' },
            { value: 'it', label: 'Italiano' }
          ]} />
      </Row>
    </Card>
  )
}
