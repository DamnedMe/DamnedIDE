import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { QrCode, Copy, Globe, Smartphone, ExternalLink } from '@/components/icons'
import { useToastStore } from '../../store'
import { useI18n } from '../../i18n'
import { APK_DOWNLOAD_URL } from '../../shared/remote/protocol'
import { SURFACE, PrimaryButton, GhostButton } from './remote-ui'

type RemoteStatus = Awaited<ReturnType<typeof window.electronAPI.remote.status>>
type PairingStart = Awaited<ReturnType<typeof window.electronAPI.remote.beginPairing>>
type Mode = 'app' | 'web'

const MODE_KEY = 'damned.remote.pairingMode'
const TEXT = { fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', lineHeight: 1.5 } as const
const STEP = { fontSize: 'calc(10.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 } as const

function useQr(text: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (!text) { setUrl(null); return }
    QRCode.toDataURL(text, { margin: 1, width: 280 }).then((u) => live && setUrl(u), () => live && setUrl(null))
    return () => { live = false }
  }, [text])
  return url
}

function QrImage({ text, label }: { text: string | null | undefined; label: string }) {
  const src = useQr(text)
  return (
    <div style={{ width: 132, height: 132, flexShrink: 0, borderRadius: 'var(--radius-sm)', background: '#fff', padding: 6, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {src ? <img src={src} alt={label} width={120} height={120} /> : <QrCode size={40} style={{ color: '#bbb' }} />}
    </div>
  )
}

function Step({ n, title, qr, qrLabel, children }: { n: number; title: string; qr?: string | null; qrLabel: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '8px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
      <QrImage text={qr} label={qrLabel} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, flex: 1 }}>
        <div style={STEP}>{n}. {title}</div>
        {children}
      </div>
    </div>
  )
}

/**
 * Pairing in Accesso remoto: the Android app and the browser webapp, each with its own two steps.
 * Three QR codes: the APK download and the webapp address are fixed; the pairing one (the same for
 * both, `damnedcloud://pair?d=…`) is generated on demand and expires.
 */
export function PairingCard({ status, pairing, secondsLeft, busy, onGenerate }: {
  status: RemoteStatus | null
  pairing: PairingStart | null
  secondsLeft: number
  busy: boolean
  onGenerate: () => Promise<PairingStart | null>
}) {
  const t = useI18n()
  const showToast = useToastStore((s) => s.showToast)
  const [mode, setModeState] = useState<Mode>(() => {
    try { return localStorage.getItem(MODE_KEY) === 'web' ? 'web' : 'app' } catch { return 'app' }
  })
  const setMode = (m: Mode) => {
    setModeState(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ }
  }
  const listening = !!status?.listening
  const valid = !!pairing && secondsLeft > 0
  const copy = (text: string, done: string) => { void navigator.clipboard.writeText(text); showToast(done) }

  const pairStep = (n: number, hint: string) => (
    <Step n={n} title={t('Pair')} qr={valid ? pairing!.pairLink : null} qrLabel={t('pairing QR')}>
      <div style={TEXT}>{hint}</div>
      {valid ? (
        <div style={{ ...TEXT, color: 'var(--accent-color)' }}>{t('expires in {s}s', { s: secondsLeft })} · {t('then confirm the code that appears here')}</div>
      ) : pairing ? (
        <div style={{ ...TEXT, color: 'var(--error-color)' }}>{t('expired — regenerate')}</div>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        <PrimaryButton onClick={() => void onGenerate()} disabled={!listening || busy}>
          <QrCode size={11} /> {valid ? t('new QR') : t('generate pairing QR')}
        </PrimaryButton>
        {valid && (
          <GhostButton onClick={() => copy(pairing!.pairLink, t('link copied'))} title={t('paste it in DamnedCloud under manual pairing')}>
            <Copy size={11} /> {t('copy code')}
          </GhostButton>
        )}
      </div>
      {!listening && <div style={{ ...TEXT, color: 'var(--warning-color)' }}>{t('Turn on the bridge first.')}</div>}
    </Step>
  )

  const openHere = async () => {
    const started = valid ? pairing : await onGenerate()
    if (started?.webUrl) void window.electronAPI.shell.openExternal(started.webUrl).catch(() => {})
  }

  const tab = (m: Mode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setMode(m)}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', cursor: 'pointer',
        fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600,
        borderRadius: 'var(--radius-sm)',
        background: mode === m ? 'var(--accent-bg)' : 'transparent',
        border: mode === m ? '1px solid var(--accent-color)' : '1px solid transparent',
        color: mode === m ? 'var(--accent-color)' : 'var(--text-muted)'
      }}
    >
      {icon} {label}
    </button>
  )

  return (
    <div style={{ ...SURFACE, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
          <QrCode size={12} /> {t('Pair a device')}
        </div>
        <div style={{ display: 'flex', gap: '4px', padding: '2px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
          {tab('app', <Smartphone size={11} />, t('Android app'))}
          {tab('web', <Globe size={11} />, t('Browser (webapp)'))}
        </div>
      </div>

      {mode === 'app' ? (
        <>
          <Step n={1} title={t('Install DamnedCloud')} qr={APK_DOWNLOAD_URL} qrLabel={t('APK download QR')}>
            <div style={TEXT}>{t('Frame it with the phone camera: it downloads the APK; open it and allow the install. Later updates are offered by the app itself.')}</div>
            <div style={TEXT}>{t('The phone needs Tailscale with the same account as this PC (guide above).')}</div>
          </Step>
          {pairStep(2, t('In DamnedCloud tap «Scan QR» and frame this code. With the camera app it opens DamnedCloud and pairs directly.'))}
        </>
      ) : !listening ? (
        <div style={TEXT}>{t('Turn on the bridge first.')}</div>
      ) : !status?.webUrl ? (
        <div style={TEXT}>{t('This installation of DamnedIDE does not include the webapp.')}</div>
      ) : (
        <>
          <Step n={1} title={t('Open the webapp')} qr={status.webUrl} qrLabel={t('webapp QR')}>
            <div style={TEXT}>{t('Frame it with the camera of the phone or tablet, or type the address in any browser. Save it in your bookmarks: the browser stays paired.')}</div>
            <div style={{ ...TEXT, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{status.webUrl}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <GhostButton onClick={() => copy(status.webUrl!, t('address copied'))}>
                <Copy size={11} /> {t('copy address')}
              </GhostButton>
              <GhostButton onClick={() => void openHere()} disabled={busy} title={t('opens the webapp in the browser of this PC, already paired after you confirm')}>
                <ExternalLink size={11} /> {t('open and pair on this PC')}
              </GhostButton>
            </div>
            {!status.lan && (
              <div style={{ ...TEXT, color: 'var(--warning-color)' }}>{t('Device on the home network without Tailscale? Tick LAN above.')}</div>
            )}
          </Step>
          {pairStep(2, t('In the webapp tap «Scan QR» and frame this code (or take a photo of it). From a computer: «copy webapp link with pairing» and open it.'))}
          {valid && pairing!.webUrl && (
            <GhostButton onClick={() => copy(pairing!.webUrl!, t('webapp link copied'))}>
              <Globe size={11} /> {t('copy webapp link with pairing')}
            </GhostButton>
          )}
        </>
      )}
    </div>
  )
}
