import { useEffect, useRef, useState } from 'react'
import { ShieldCheck, Loader2, Check, AlertCircle, Copy, ExternalLink, X } from '@/components/icons'
import { Modal } from '../layout/Modal'
import type { SqlConnectionConfig } from '../../types/sql'
import { firewallRuleName, parseAzureFirewallError, setFirewallRuleStatement, type AzureFirewallBlock } from '../../shared/sqlAzureFirewall'
import { useToastStore } from '../../store'
import { tr, useI18n } from '../../i18n'

export interface AzureFirewallRequest {
  /** the connection's server field (host of the Azure SQL logical server) */
  server: string
  block: AzureFirewallBlock
  /** tested again until the rule is live: Azure applies it within seconds, up to five minutes */
  config: SqlConnectionConfig
  /** runs once the server lets this IP in, e.g. the connect that failed */
  onAuthorized?: () => void | Promise<void>
}

type Phase =
  | { kind: 'ask' }
  | { kind: 'working' }
  | { kind: 'waiting'; attempt: number; ruleName: string; portalUrl: string }
  | { kind: 'done'; ruleName: string; portalUrl: string; note?: string }
  | { kind: 'error'; message: string }

const RETRY_EVERY_MS = 5_000
const RETRY_FOR_MS = 3 * 60_000

const text: React.CSSProperties = {
  fontSize: 'calc(10.5px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', lineHeight: 1.5
}

function btn(enabled = true, accent = false): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 14px', height: '28px',
    background: enabled && accent ? 'var(--accent-color)' : 'var(--bg-card)',
    border: `1px solid ${enabled && accent ? 'var(--accent-color)' : 'var(--border-color)'}`,
    borderRadius: 'var(--radius-sm)',
    color: enabled && accent ? 'var(--text-inverse)' : (enabled ? 'var(--text-secondary)' : 'var(--text-disabled)'),
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.6,
    fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
  }
}

const cleanError = (e: unknown) => ((e as Error)?.message || String(e)).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')

/**
 * Azure SQL refused the login because of the server firewall (error 40615): offers to add a rule
 * for the IP Azure saw, signing in to Azure (CLI login or browser), then waits until the rule is
 * live and runs the action that failed again.
 */
export function AzureFirewallDialog({ request, onClose }: { request: AzureFirewallRequest; onClose: () => void }) {
  const t = useI18n()
  const showToast = useToastStore(s => s.showToast)
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' })
  const closed = useRef(false)
  // set again on mount: StrictMode mounts, unmounts and mounts again
  useEffect(() => {
    closed.current = false
    return () => { closed.current = true }
  }, [])

  const { block, server } = request
  const busy = phase.kind === 'working' || phase.kind === 'waiting'
  const serverName = block.server || server.split('.')[0]

  const close = () => {
    if (phase.kind === 'working') void window.electronAPI.sql.azureFirewallCancel().catch(() => {})
    onClose()
  }

  const authorize = async () => {
    setPhase({ kind: 'working' })
    let rule: { ruleName: string; portalUrl: string }
    try {
      rule = await window.electronAPI.sql.azureFirewallAllow(server, block.ip)
    } catch (e) {
      if (!closed.current) setPhase({ kind: 'error', message: cleanError(e) })
      return
    }
    if (closed.current) return
    showToast(tr('firewall rule {rule} saved on {server}', { rule: rule.ruleName, server: serverName }))
    const started = Date.now()
    for (let attempt = 1; !closed.current; attempt++) {
      setPhase({ kind: 'waiting', attempt, ...rule })
      const test = await window.electronAPI.sql.testConnection(request.config).catch(e => ({ ok: false, error: cleanError(e) }))
      if (closed.current) return
      const stillBlocked = !test.ok && parseAzureFirewallError(test.error)
      if (!stillBlocked) {
        if (test.ok) {
          try {
            await request.onAuthorized?.()
          } catch { /* the action reports its own error */ }
          if (!closed.current) onClose()
          return
        }
        // the firewall lets the IP in now: what fails is something else (login, database…)
        setPhase({ kind: 'done', ...rule, note: test.error })
        return
      }
      if (Date.now() - started > RETRY_FOR_MS) {
        setPhase({ kind: 'done', ...rule, note: tr('Azure has not applied the rule yet: it can take up to five minutes. Try connecting again shortly.') })
        return
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_EVERY_MS))
    }
  }

  const statement = setFirewallRuleStatement(firewallRuleName('<computer>'), block.ip)

  return (
    <Modal onClose={close} width={560} label={t('Azure SQL firewall')}>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t('Authorize this IP on the Azure SQL firewall')}
            </div>
            <div style={{ fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {server} · IP {block.ip}
            </div>
          </div>
          <button onClick={close} title={t('close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}>
            <X size={14} />
          </button>
        </div>

        {phase.kind === 'ask' && (
          <div style={text}>
            {t('The firewall of {server} does not let in the IP {ip} this computer has on this network. DamnedIDE can add a rule for it with your Azure account (the Azure CLI or PowerShell login if there is one, otherwise a sign-in in the browser). The account needs the SQL Server Contributor or Contributor role on the server; the rule keeps one name per computer, so a new IP replaces the previous one.', { server: serverName, ip: block.ip })}
          </div>
        )}

        {phase.kind === 'working' && (
          <div style={{ ...text, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            {t('Signing in to Azure and saving the rule… if a browser page opens, sign in there.')}
          </div>
        )}

        {phase.kind === 'waiting' && (
          <div style={{ ...text, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            {t('Rule {rule} saved. Waiting for Azure to apply it (attempt {n})…', { rule: phase.ruleName, n: phase.attempt })}
          </div>
        )}

        {phase.kind === 'done' && (
          <div style={{ ...text, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--success-color)' }}>
              <Check size={12} /> {t('Rule {rule} saved for {ip}.', { rule: phase.ruleName, ip: block.ip })}
            </span>
            {phase.note && <span style={{ color: 'var(--text-muted)' }}>{phase.note}</span>}
          </div>
        )}

        {phase.kind === 'error' && (
          <div style={{ ...text, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', color: 'var(--error-color)' }}>
              <AlertCircle size={12} style={{ flexShrink: 0, marginTop: '2px' }} /> {phase.message}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              {t('Alternatively, an administrator can run this on the master database from a network the firewall already allows:')}
            </span>
            <code style={{
              display: 'block', padding: '6px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text'
            }}>{statement}</code>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          {phase.kind === 'error' && (
            <button style={btn()} onClick={() => { void navigator.clipboard.writeText(statement); showToast(tr('command copied')) }}>
              <Copy size={11} /> {t('copy command')}
            </button>
          )}
          {(phase.kind === 'done' || phase.kind === 'waiting') && (
            <button style={btn()} onClick={() => void window.electronAPI.shell.openExternal(phase.portalUrl)}>
              <ExternalLink size={11} /> {t('open in the Azure portal')}
            </button>
          )}
          <button style={btn()} onClick={close}>{phase.kind === 'done' ? t('close') : t('cancel')}</button>
          {(phase.kind === 'ask' || phase.kind === 'error') && (
            <button style={btn(!busy, true)} disabled={busy} onClick={() => void authorize()}>
              <ShieldCheck size={11} /> {phase.kind === 'error' ? t('try again') : t('authorize IP')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
