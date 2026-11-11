import { useCallback, useEffect, useRef, useState } from 'react'
import {
  QrCode,
  Power,
  RefreshCw,
  Trash2,
  ShieldCheck,
  Loader2,
  Check,
  X,
  Wifi,
  WifiOff,
  Copy,
  AlertTriangle
} from '@/components/icons'
import { useToastStore } from '../../store'
import { tr, useI18n } from '../../i18n'
import { ALL_SCOPES, type RemoteScope } from '../../shared/remote/protocol'

type RemoteStatus = Awaited<ReturnType<typeof window.electronAPI.remote.status>>
type DeviceInfo = Awaited<ReturnType<typeof window.electronAPI.remote.devices>>[number]
type PairingStart = Awaited<ReturnType<typeof window.electronAPI.remote.beginPairing>>
type PendingPairing = Awaited<ReturnType<typeof window.electronAPI.remote.pending>>[number]

const SURFACE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px'
} as const

const BTN = {
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  padding: '5px 12px',
  height: '28px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 'calc(10px * var(--ui-text-scale, 1))',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600
} as const

function PrimaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        ...BTN,
        background: rest.disabled ? 'var(--bg-subtle)' : 'var(--accent-color)',
        border: 'none',
        color: rest.disabled ? 'var(--text-muted)' : 'var(--text-inverse)',
        cursor: rest.disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {children}
    </button>
  )
}

function GhostButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        ...BTN,
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border-color)',
        color: 'var(--text-secondary)',
        cursor: rest.disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {children}
    </button>
  )
}

export function RemotePanel() {
  const t = useI18n()
  const showToast = useToastStore((s) => s.showToast)
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [pairing, setPairing] = useState<PairingStart | null>(null)
  const [pending, setPending] = useState<PendingPairing[]>([])
  const [busy, setBusy] = useState(false)
  const [port, setPort] = useState(8765)
  const [now, setNow] = useState(Date.now())
  const statusRef = useRef<RemoteStatus | null>(null)
  statusRef.current = status

  const refresh = useCallback(async () => {
    try {
      const [st, devs, pend] = await Promise.all([
        window.electronAPI.remote.status(),
        window.electronAPI.remote.devices(),
        window.electronAPI.remote.pending()
      ])
      setStatus(st)
      setDevices(devs)
      setPending(pend)
      if (!statusRef.current) setPort(st.port)
    } catch (e) {
      showToast((e as Error).message || tr('remote access status not available'), 'error')
    }
  }, [showToast])

  useEffect(() => {
    void refresh()
    const off = window.electronAPI.remote.onEvent(({ event }) => {
      if (event === 'device-changed' || event === 'pairing-request' || event === 'pairing-resolved') void refresh()
      if (event === 'log') { /* logged in main */ }
    })
    return off
  }, [refresh])

  useEffect(() => {
    if (!pairing) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [pairing])

  const toggle = async () => {
    setBusy(true)
    try {
      if (status?.listening) {
        const st = await window.electronAPI.remote.stop()
        setStatus(st)
        setPairing(null)
        showToast(tr('remote access turned off'))
      } else {
        const st = await window.electronAPI.remote.start({ port })
        setStatus(st)
        showToast(st.warning || tr('bridge active on {host}:{port}', { host: st.host, port: st.port }), st.warning ? 'info' : 'success')
      }
    } catch (e) {
      showToast((e as Error).message || tr('operation failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const generateQr = async () => {
    setBusy(true)
    try {
      setPairing(await window.electronAPI.remote.beginPairing())
      setNow(Date.now())
    } catch (e) {
      showToast((e as Error).message || tr('QR generation failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const resolvePairing = async (id: string, accepted: boolean) => {
    await window.electronAPI.remote.resolvePairing(id, accepted)
    await refresh()
  }

  const setScopes = async (id: string, scopes: RemoteScope[]) => {
    const devs = await window.electronAPI.remote.setScopes(id, scopes)
    setDevices(devs)
  }

  const revoke = async (id: string) => {
    setDevices(await window.electronAPI.remote.revoke(id))
    showToast(tr('device removed'))
  }

  // SCOPE_LABELS (shared/remote/protocol) is Italian and node-checked: labels are translated here
  const scopeLabel = (scope: RemoteScope): string => ({
    view: t('Read only'),
    edit: t('Edit files'),
    git: t('Git operations'),
    sql: t('SQL queries'),
    sqlDestructive: t('Destructive SQL (backup/restore/mutations)'),
    terminal: t('Terminal and processes')
  })[scope]

  const secondsLeft = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0
  const ts = status?.tailscale

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Status card */}
      <div style={{ ...SURFACE, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {status?.listening ? (
              <Wifi size={14} style={{ color: 'var(--success-color)', flexShrink: 0 }} />
            ) : (
              <WifiOff size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {status?.listening ? `${status.host}:${status.port}` : t('not active')}
              </div>
              <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {ts?.running ? `Tailscale: ${ts.dnsName || ts.ipv4}` : ts?.available ? t('Tailscale not connected') : t('Tailscale not detected')}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {!status?.listening && (
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 8765)}
                title={t('bridge port')}
                style={{
                  width: '72px',
                  height: '28px',
                  padding: '0 8px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: 'calc(10px * var(--ui-text-scale, 1))',
                  fontFamily: 'var(--font-mono)',
                  outline: 'none'
                }}
              />
            )}
            <PrimaryButton onClick={toggle} disabled={busy}>
              {busy ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Power size={11} />}
              {status?.listening ? t('turn off') : t('turn on')}
            </PrimaryButton>
          </div>
        </div>
        {status?.warning && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--warning-color)', fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            <AlertTriangle size={11} /> {status.warning}
          </div>
        )}
      </div>

      {/* Pending pairing confirmations */}
      {pending.map((p) => (
        <div key={p.id} style={{ ...SURFACE, border: '1px solid var(--accent-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {t('Pairing request from')} <strong>{p.name}</strong> ({p.platform})
          </div>
          <div style={{ fontSize: 'calc(20px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', letterSpacing: '4px', color: 'var(--accent-color)' }}>
            {p.code}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <PrimaryButton onClick={() => void resolvePairing(p.id, true)}>
              <Check size={11} /> {t('accept')}
            </PrimaryButton>
            <GhostButton onClick={() => void resolvePairing(p.id, false)}>
              <X size={11} /> {t('reject')}
            </GhostButton>
          </div>
        </div>
      ))}

      {/* Pairing QR */}
      <div style={{ ...SURFACE, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
            <QrCode size={12} /> {t('Pair a device')}
          </div>
          <PrimaryButton onClick={generateQr} disabled={!status?.listening || busy}>
            <QrCode size={11} /> {t('generate QR')}
          </PrimaryButton>
        </div>
        {pairing ? (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <img src={pairing.qrDataUrl} alt={t('pairing QR')} width={148} height={148} style={{ borderRadius: 'var(--radius-sm)', background: '#fff', padding: '6px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
              <div style={{ fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                {pairing.payload.host}:{pairing.payload.port} · {pairing.payload.tls ? 'wss' : 'ws'} (WireGuard)
              </div>
              <div style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: secondsLeft > 0 ? 'var(--accent-color)' : 'var(--error-color)' }}>
                {secondsLeft > 0 ? t('expires in {s}s', { s: secondsLeft }) : t('expired — regenerate')}
              </div>
              <GhostButton onClick={() => { void navigator.clipboard.writeText(pairing.url); showToast(t('link copied')) }}>
                <Copy size={11} /> {t('copy link')}
              </GhostButton>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            {t('Make sure the phone has Tailscale active on the same network, then scan the QR to download DamnedCloud and pair it.')}
          </div>
        )}
      </div>

      {/* Devices */}
      <div style={{ ...SURFACE, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
            <ShieldCheck size={12} /> {t('Devices ({n})', { n: devices.length })}
          </div>
          <GhostButton onClick={() => void refresh()}>
            <RefreshCw size={11} /> {t('refresh')}
          </GhostButton>
        </div>
        {devices.length === 0 && (
          <div style={{ fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            {t('No paired devices.')}
          </div>
        )}
        {devices.map((d) => (
          <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'calc(10.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {d.name} <span style={{ color: 'var(--text-muted)' }}>· {d.platform}</span>
                </div>
                <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {t('last seen: {when}', { when: d.lastSeen ? new Date(d.lastSeen).toLocaleString() : t('never') })}
                </div>
              </div>
              <GhostButton onClick={() => void revoke(d.id)}>
                <Trash2 size={11} /> {t('revoke')}
              </GhostButton>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {/* ponytail: no remote command needs 'terminal' yet (P2), so granting it would do nothing;
                  the scope stays in the protocol type, only its toggle is hidden */}
              {ALL_SCOPES.filter((scope) => scope !== 'terminal').map((scope) => {
                const active = d.scopes.includes(scope)
                return (
                  <button
                    key={scope}
                    onClick={() => void setScopes(d.id, active ? d.scopes.filter((s) => s !== scope) : [...d.scopes, scope])}
                    title={scopeLabel(scope)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'calc(9px * var(--ui-text-scale, 1))',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      background: active ? 'var(--accent-bg)' : 'var(--bg-subtle)',
                      border: active ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
                      color: active ? 'var(--accent-color)' : 'var(--text-muted)'
                    }}
                  >
                    {scopeLabel(scope)}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {devices.length > 0 && (
          <GhostButton onClick={async () => { setDevices(await window.electronAPI.remote.revokeAll()); showToast(tr('all devices removed')) }}>
            <Trash2 size={11} /> {t('revoke all')}
          </GhostButton>
        )}
      </div>
    </div>
  )
}
