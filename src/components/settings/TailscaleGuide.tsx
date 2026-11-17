import { Copy, ExternalLink } from '@/components/icons'
import { useToastStore } from '../../store'
import { useI18n } from '../../i18n'

const LINKS = {
  download: 'https://tailscale.com/download',
  android: 'https://play.google.com/store/apps/details?id=com.tailscale.ipn',
  ios: 'https://apps.apple.com/app/tailscale/id1470499037'
}

const LINUX = 'curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up'
const ARCH = 'sudo pacman -S tailscale && sudo systemctl enable --now tailscaled && sudo tailscale up'

const TEXT = { fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', lineHeight: 1.5 } as const
const TITLE = { fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontWeight: 600 } as const
const LINK = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-color)', font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '3px' } as const

/** How to put the PC and the phone on the same tailnet; open by default while Tailscale is not running here. */
export function TailscaleGuide({ open }: { open: boolean }) {
  const t = useI18n()
  const showToast = useToastStore((s) => s.showToast)
  const link = (url: string, label: string) => (
    <button style={LINK} onClick={() => void window.electronAPI.shell.openExternal(url).catch(() => {})}>
      {label} <ExternalLink size={9} />
    </button>
  )
  const command = (cmd: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '4px 8px' }}>
      <code style={{ ...TEXT, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflowX: 'auto', whiteSpace: 'nowrap' }}>{cmd}</code>
      <button style={LINK} title={t('copy command')} onClick={() => { void navigator.clipboard.writeText(cmd); showToast(t('command copied')) }}>
        <Copy size={10} />
      </button>
    </div>
  )

  return (
    <details open={open} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <summary style={{ ...TITLE, cursor: 'pointer' }}>{t('How to install Tailscale on the PC and on the phone')}</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
        <div style={TEXT}>
          {t('Tailscale puts the PC and the phone in the same private network (WireGuard), even away from home. It is free for personal use: create an account on first sign-in and use the same account on both devices.')}
        </div>

        <div style={TITLE}>{t('1. On this PC')}</div>
        <div style={TEXT}>
          {t('Windows and macOS:')} {link(LINKS.download, 'tailscale.com/download')}{t(', install, then sign in from the Tailscale icon in the tray / menu bar.')}
        </div>
        <div style={TEXT}>{t('Linux:')}</div>
        {command(LINUX)}
        <div style={TEXT}>{t('Arch / CachyOS:')}</div>
        {command(ARCH)}
        <div style={TEXT}>{t('tailscale up prints a link: open it and sign in.')}</div>

        <div style={TITLE}>{t('2. On the phone')}</div>
        <div style={TEXT}>
          {t('Android:')} {link(LINKS.android, 'Google Play')} · {t('iPhone:')} {link(LINKS.ios, 'App Store')}
          {t(' (on iPhone use the webapp in Safari).')}
        </div>
        <div style={TEXT}>{t('Open the app, sign in with the same account as the PC and turn on the VPN when asked.')}</div>

        <div style={TITLE}>{t('3. Check')}</div>
        <div style={TEXT}>
          {t('Turn the bridge off and on again: the line above shows "Tailscale: <name>". In the Tailscale app on the phone the PC appears among the machines. Keep the VPN on in the phone while using DamnedCloud.')}
        </div>
      </div>
    </details>
  )
}
