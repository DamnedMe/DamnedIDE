import { useEffect, useState } from 'react'
import { PlugZap, Copy, Eye, EyeOff, KeyRound, ShieldCheck, History, Bot, Wrench, Check, X } from '@/components/icons'
import { ALL_SCOPES, type RemoteScope } from '../../shared/remote/protocol'
import { useToastStore } from '../../store'
import { useI18n, tr } from '../../i18n'
import { Btn, Card, CardBody, Chip, Notice, PathText, Row, SubHeading, Toggle, inputStyle, ipcMessage, px } from './ui'

/**
 * DamnedIDE as an MCP server (electron/services/mcp/mcp-server.service.ts): agents use the IDE's
 * git, files, SQL connections, worktrees and release with the permissions chosen here; actions
 * the phone confirms are confirmed by the user in a desktop dialog. The AI chat's Claude gets it
 * by itself, any other MCP client is added with the command below.
 */
export function McpServerPanel() {
  const t = useI18n()
  const showToast = useToastStore(s => s.showToast)
  const [status, setStatus] = useState<McpServerStatus | null>(null)
  const [port, setPort] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const load = () => window.electronAPI.mcpServer.status().then(s => { setStatus(s); setPort(p => p || String(s.port)) }).catch(() => {})
    load()
    return window.electronAPI.mcpServer.onChanged(load)
  }, [])

  const update = async (patch: { enabled?: boolean; port?: number; scopes?: RemoteScope[]; newToken?: boolean }) => {
    setBusy(true)
    try {
      const s = await window.electronAPI.mcpServer.update(patch)
      setStatus(s)
      setPort(String(s.port))
    } catch (e) {
      showToast(ipcMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => showToast(tr('copied'))).catch(() => showToast(tr('copy failed'), 'error'))
  }

  if (!status) return null

  const scopeLabel = (scope: RemoteScope): string => ({
    view: t('Read only'),
    edit: t('Edit files'),
    git: t('Git operations'),
    sql: t('SQL queries'),
    sqlDestructive: t('Destructive SQL (backup/restore/mutations)'),
    terminal: t('Terminal and processes')
  })[scope]

  const auth = `Authorization: Bearer ${status.token}`
  const shownAuth = showToken ? auth : 'Authorization: Bearer ••••••••'
  const addCommand = (header: string) => `claude mcp add --transport http damnedide ${status.url} --header "${header}"`
  const portValue = Number(port)
  const portValid = Number.isInteger(portValue) && portValue >= 1024 && portValue <= 65535
  const allowed = status.tools.filter(tool => tool.allowed).length

  return (
    <>
      <Card>
        <Row icon={<PlugZap size={13} />} label={t('MCP server')}
          hint={t('agents reach the IDE at {url}, only from this computer and with the token below', { url: status.url })}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {status.enabled && (status.listening
              ? <Chip tone="success" icon={<Check size={10} />}>{t('active')}</Chip>
              : <Chip tone="error" icon={<X size={10} />}>{t('not active')}</Chip>)}
            <Toggle checked={status.enabled} onChange={(v) => void update({ enabled: v })} title={t('MCP server')} />
          </div>
        </Row>
        <Row label={t('port')} hint={t('local port of the server (1024-65535)')}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} aria-label={t('port')}
              style={{ ...inputStyle, width: px(80), minHeight: px(26) }} />
            <Btn disabled={busy || !portValid || portValue === status.port} onClick={() => void update({ port: portValue })}>{t('apply')}</Btn>
          </div>
        </Row>
        {status.error && <CardBody><Notice tone="error">{status.error}</Notice></CardBody>}
      </Card>

      <SubHeading>{t('permissions of the agents')}</SubHeading>
      <Card>
        <CardBody>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {/* no command needs 'terminal' yet: its toggle stays hidden, as for the paired phones */}
            {ALL_SCOPES.filter(scope => scope !== 'terminal').map(scope => {
              const active = status.scopes.includes(scope)
              return (
                <button key={scope} disabled={busy} aria-pressed={active}
                  onClick={() => void update({ scopes: active ? status.scopes.filter(s => s !== scope) : [...status.scopes, scope] })}
                  style={{
                    padding: '4px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    fontSize: px(10), fontFamily: 'var(--font-mono)',
                    background: active ? 'var(--accent-bg)' : 'var(--bg-subtle)',
                    border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`,
                    color: active ? 'var(--accent-color)' : 'var(--text-muted)'
                  }}>
                  {scopeLabel(scope)}
                </button>
              )
            })}
          </div>
          <Notice tone="info" icon={<ShieldCheck size={12} />}>
            {t('Discarding changes, removing a worktree, a query that changes data and a release to production are always confirmed by you in a DamnedIDE dialog. Files stay inside the open repository and worktree.')}
          </Notice>
        </CardBody>
      </Card>

      <SubHeading>{t('connect an agent')}</SubHeading>
      <Card>
        <Row icon={<Bot size={13} />} label={t('AI chat of the IDE')}
          hint={t('Claude in the AI chat (subscription CLI) gets this server by itself while it is active')}>
          {status.listening ? <Chip tone="success">{t('connected')}</Chip> : <Chip>{t('server off')}</Chip>}
        </Row>
        <CardBody>
          <span style={{ fontSize: px(10), color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {t('Claude Code in a terminal (or any MCP client over HTTP):')}
          </span>
          <PathText>{addCommand(shownAuth)}</PathText>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <Btn onClick={() => copy(addCommand(auth))}><Copy size={11} /> {t('copy command')}</Btn>
            <Btn onClick={() => setShowToken(v => !v)}>{showToken ? <EyeOff size={11} /> : <Eye size={11} />} {showToken ? t('hide token') : t('show token')}</Btn>
            <Btn variant="danger" disabled={busy} onClick={() => void update({ newToken: true })}>
              <KeyRound size={11} /> {t('new token')}
            </Btn>
          </div>
          <span style={{ fontSize: px(9), color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
            {t('A new token disconnects every agent configured with the old one.')}
          </span>
        </CardBody>
      </Card>

      <SubHeading>{t('{n} of {total} tools enabled', { n: allowed, total: status.tools.length })}</SubHeading>
      <Card>
        <CardBody gap={4}>
          {status.tools.map(tool => (
            <div key={tool.name} title={tool.description} style={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0, opacity: tool.allowed ? 1 : 0.45 }}>
              <Wrench size={10} style={{ flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: px(10), color: 'var(--text-primary)', flexShrink: 0 }}>{tool.name}</span>
              <span style={{ fontSize: px(9.5), color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.description}</span>
            </div>
          ))}
        </CardBody>
      </Card>

      {status.calls.length > 0 && (
        <>
          <SubHeading>{t('last calls')}</SubHeading>
          <Card>
            <CardBody gap={3}>
              {status.calls.map((c, i) => (
                <div key={`${c.at}-${i}`} style={{ display: 'flex', gap: '8px', fontFamily: 'var(--font-mono)', fontSize: px(9.5), minWidth: 0 }}>
                  <History size={10} style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-muted)' }} />
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{new Date(c.at).toLocaleTimeString()}</span>
                  <span style={{ color: c.ok ? 'var(--text-primary)' : 'var(--error-color)', flexShrink: 0 }}>{c.tool}</span>
                  {c.message && <span style={{ color: 'var(--error-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.message}</span>}
                </div>
              ))}
            </CardBody>
          </Card>
        </>
      )}
    </>
  )
}
