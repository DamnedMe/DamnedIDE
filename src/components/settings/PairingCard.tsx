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
/** Displayed QR side: the pairing code is dense, smaller than this a photo of the screen blurs it. */
const QR_PX = 240
const TEXT = { fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', lineHeight: 1.5 } as const
const STEP = { fontSize: 'calc(10.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 } as const

function useQr(text: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (!text) { setUrl(null); return }
    // L: the least dense code (the screen is clean); 2x the displayed size so it stays sharp.
    QRCode.toDataURL(text, { margin: 1, width: 2 * QR_PX, errorCorrectionLevel: 'L' }).then((u) => live && setUrl(u), () => live && setUrl(null))
    return () => { live = false }
  }, [text])
  return url
}

function QrImage({ text, label }: { text: string | null | undefined; label: string }) {
  const src = useQr(text)
  return (
    <div style={{ width: QR_PX + 12, height: QR_PX + 12, flexShrink: 0, borderRadius: 'var(--radius-sm)', background: '#fff', padding: 6, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {src ? <img src={src} alt={label} width={QR_PX} height={QR_PX} /> : <QrCode size={40} style={{ color: '#bbb' }} />}
    </div>
  )
}

function Step({ n, title, qr, qrLabel, children }: { n: number; title: string; qr?: string | null; qrLabel: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start', padding: '8px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
      <QrImage text={qr} label={qrLabel} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 200, flex: 1 }}>
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
  // One QR at a time, as large as the panel allows: 1 install/open, 2 pair.
  const [step, setStep] = useState<1 | 2>(1)
  const setMode = (m: Mode) => {
    setModeState(m)
    setStep(1)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ }
  }
  const listening = !!status?.listening
  const valid = !!pairing && secondsLeft > 0
  const copy = (text: string, done: string) => { void navigator.clipboard.writeText(text); showToast(done) }

  // The app scans the deep link; the webapp's link opens the webapp already paired from any camera app.
  const pairStep = (n: number, hint: string, link: string | undefined, copyLabel: string) => (
    <Step n={n} title={t('Pair')} qr={valid ? link : null} qrLabel={t('pairing QR')}>
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
          <GhostButton onClick={() => copy(link ?? pairing!.pairLink, t('link copied'))}>
            <Copy size={11} /> {copyLabel}
          </GhostButton>
        )}
      </div>
      {!listening && <div style={{ ...TEXT, color: 'var(--warning-color)' }}>{t('Turn on the bridge first.')}</div>}
    </Step>
  )

  const goPair = () => {
    setStep(2)
    if (!valid && listening && !busy) void onGenerate()
  }

  const openHere = async () => {
    const started = valid ? pairing : await onGenerate()
    if (started?.webUrl) void window.electronAPI.shell.openExternal(started.webUrl).catch(() => {})
  }

  const pill = (active: boolean, onClick: () => void, children: React.ReactNode) => (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', cursor: 'pointer',
        fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600,
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--accent-bg)' : 'transparent',
        border: active ? '1px solid var(--accent-color)' : '1px solid transparent',
        color: active ? 'var(--accent-color)' : 'var(--text-muted)'
      }}
    >
      {children}
    </button>
  )

  const firstTitle = mode === 'app' ? t('Install DamnedCloud') : t('Open the webapp')
  const ready = mode === 'app' || (listening && !!status?.webUrl)

  return (
    <div style={{ ...SURFACE, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
          <QrCode size={12} /> {t('Pair a device')}
        </div>
        <div style={{ display: 'flex', gap: '4px', padding: '2px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
          {pill(mode === 'app', () => setMode('app'), <><Smartphone size={11} /> {t('Android app')}</>)}
          {pill(mode === 'web', () => setMode('web'), <><Globe size={11} /> {t('Browser (webapp)')}</>)}
        </div>
      </div>

      {!ready ? (
        <div style={TEXT}>{listening ? t('This installation of DamnedIDE does not include the webapp.') : t('Turn on the bridge first.')}</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '4px' }}>
            {pill(step === 1, () => setStep(1), <>1. {firstTitle}</>)}
            {pill(step === 2, goPair, <>2. {t('Pair')}</>)}
          </div>

          {step === 1 && mode === 'app' && (
            <Step n={1} title={firstTitle} qr={APK_DOWNLOAD_URL} qrLabel={t('APK download QR')}>
              <div style={TEXT}>{t('Frame it with the phone camera: it downloads the APK; open it and allow the install. Later updates are offered by the app itself.')}</div>
              <div style={TEXT}>{t('The phone needs Tailscale with the same account as this PC (guide above).')}</div>
            </Step>
          )}
          {step === 1 && mode === 'web' && (
            <Step n={1} title={firstTitle} qr={status!.webUrl} qrLabel={t('webapp QR')}>
              <div style={TEXT}>{t('Frame it with the camera of the phone or tablet, or type the address in any browser.')}</div>
              <div style={TEXT}>{t('Want it as an app? Add it to the home screen now and pair from there: on iPhone the home-screen app keeps its own pairing, apart from Safari.')}</div>
              <div style={{ ...TEXT, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{status!.webUrl}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <GhostButton onClick={() => copy(status!.webUrl!, t('address copied'))}>
                  <Copy size={11} /> {t('copy address')}
                </GhostButton>
                <GhostButton onClick={() => void openHere()} disabled={busy} title={t('opens the webapp in the browser of this PC, already paired after you confirm')}>
                  <ExternalLink size={11} /> {t('open and pair on this PC')}
                </GhostButton>
              </div>
              {!status!.lan && (
                <div style={{ ...TEXT, color: 'var(--warning-color)' }}>{t('Device on the home network without Tailscale? Tick LAN above.')}</div>
              )}
            </Step>
          )}
          {step === 2 && (mode === 'app'
            ? pairStep(2, t('In DamnedCloud tap «Scan QR» and frame this code. With the camera app it opens DamnedCloud and pairs directly.'), pairing?.pairLink, t('copy code'))
            : pairStep(2, t('Frame this code with the phone camera app: it opens the webapp already paired in the browser. From the home-screen app: «Scan QR» and take a photo of it. From a computer: copy the link and open it in the browser.'), pairing?.webUrl, t('copy webapp link with pairing')))}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {step === 1 ? (
              <PrimaryButton onClick={goPair}>{t('Next: pair')} →</PrimaryButton>
            ) : (
              <GhostButton onClick={() => setStep(1)}>← {firstTitle}</GhostButton>
            )}
          </div>
        </>
      )}
    </div>
  )
}
