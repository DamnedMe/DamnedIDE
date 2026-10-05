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
} from 'lucide-react'
import { useToastStore } from '../../store'
import { ALL_SCOPES, SCOPE_LABELS, type RemoteScope } from '../../shared/remote/protocol'

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
      showToast((e as Error).message || 'stato accesso remoto non disponibile', 'error')
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
        showToast('accesso remoto disattivato')
      } else {
        const st = await window.electronAPI.remote.start({ port })
        setStatus(st)
        showToast(st.warning || `bridge attivo su ${st.host}:${st.port}`, st.warning ? 'info' : 'success')
      }
    } catch (e) {
      showToast((e as Error).message || 'operazione fallita', 'error')
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
      showToast((e as Error).message || 'generazione QR fallita', 'error')
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
    showToast('dispositivo rimosso')
  }

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
                {status?.listening ? `${status.host}:${status.port}` : 'non attivo'}
              </div>
              <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {ts?.running ? `Tailscale: ${ts.dnsName || ts.ipv4}` : ts?.available ? 'Tailscale non connesso' : 'Tailscale non rilevato'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {!status?.listening && (
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 8765)}
                title="porta del bridge"
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
              {status?.listening ? 'disattiva' : 'attiva'}
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
            Richiesta di associazione da <strong>{p.name}</strong> ({p.platform})
          </div>
          <div style={{ fontSize: 'calc(20px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', letterSpacing: '4px', color: 'var(--accent-color)' }}>
            {p.code}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <PrimaryButton onClick={() => void resolvePairing(p.id, true)}>
              <Check size={11} /> accetta
            </PrimaryButton>
            <GhostButton onClick={() => void resolvePairing(p.id, false)}>
              <X size={11} /> rifiuta
            </GhostButton>
          </div>
        </div>
      ))}

      {/* Pairing QR */}
      <div style={{ ...SURFACE, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
            <QrCode size={12} /> Associa un dispositivo
          </div>
          <PrimaryButton onClick={generateQr} disabled={!status?.listening || busy}>
            <QrCode size={11} /> genera QR
          </PrimaryButton>
        </div>
        {pairing ? (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <img src={pairing.qrDataUrl} alt="QR di associazione" width={148} height={148} style={{ borderRadius: 'var(--radius-sm)', background: '#fff', padding: '6px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
              <div style={{ fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                {pairing.payload.host}:{pairing.payload.port} · {pairing.payload.tls ? 'wss' : 'ws'} (WireGuard)
              </div>
              <div style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: secondsLeft > 0 ? 'var(--accent-color)' : 'var(--error-color)' }}>
                {secondsLeft > 0 ? `scade tra ${secondsLeft}s` : 'scaduto — rigenera'}
              </div>
              <GhostButton onClick={() => { void navigator.clipboard.writeText(pairing.url); showToast('link copiato') }}>
                <Copy size={11} /> copia link
              </GhostButton>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            Assicurati che il telefono abbia Tailscale attivo sulla stessa rete, poi scansiona il QR per scaricare DamnedCloud e associarlo.
          </div>
        )}
      </div>

      {/* Devices */}
      <div style={{ ...SURFACE, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
            <ShieldCheck size={12} /> Dispositivi ({devices.length})
          </div>
          <GhostButton onClick={() => void refresh()}>
            <RefreshCw size={11} /> aggiorna
          </GhostButton>
        </div>
        {devices.length === 0 && (
          <div style={{ fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            Nessun dispositivo associato.
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
                  ultimo accesso: {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : 'mai'}
                </div>
              </div>
              <GhostButton onClick={() => void revoke(d.id)}>
                <Trash2 size={11} /> revoca
              </GhostButton>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {ALL_SCOPES.map((scope) => {
                const active = d.scopes.includes(scope)
                return (
                  <button
                    key={scope}
                    onClick={() => void setScopes(d.id, active ? d.scopes.filter((s) => s !== scope) : [...d.scopes, scope])}
                    title={SCOPE_LABELS[scope]}
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
                    {SCOPE_LABELS[scope]}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {devices.length > 0 && (
          <GhostButton onClick={async () => { setDevices(await window.electronAPI.remote.revokeAll()); showToast('tutti i dispositivi rimossi') }}>
            <Trash2 size={11} /> revoca tutti
          </GhostButton>
        )}
      </div>
    </div>
  )
}
