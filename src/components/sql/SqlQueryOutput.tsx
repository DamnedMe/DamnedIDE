import { ReactNode, useEffect, useState } from 'react'
import { AlertCircle, Check, Clock3, Loader2, MessageSquareText, Table2 } from '@/components/icons'
import { SqlExecutionResult } from '../../types/sql'
import { useSqlSectionZoom } from './useSqlSectionZoom'
import { useI18n } from '../../i18n'

export type SqlQueryMessageTone = 'running' | 'success' | 'error' | 'info'

export interface SqlQueryMessage {
  id: string
  at: number
  tone: SqlQueryMessageTone
  text: string
}

export interface SqlRunningQuery {
  queryId: string
  verb: string
  database: string
  startedAt: number
}

interface SqlQueryOutputProps {
  execution: SqlExecutionResult | null
  messages: SqlQueryMessage[]
  running: SqlRunningQuery | null
  selected: 'results' | 'messages'
  onSelected: (value: 'results' | 'messages') => void
  children: ReactNode
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    height: 28, padding: '0 11px', display: 'inline-flex', alignItems: 'center', gap: 5,
    border: 0, borderBottom: active ? '2px solid var(--accent-color)' : '2px solid transparent',
    background: active ? 'var(--bg-card)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'calc(9.5px * var(--ui-text-scale, 1))', fontWeight: active ? 600 : 500
  }
}

export function SqlQueryOutput({ execution, messages, running, selected, onSelected, children }: SqlQueryOutputProps) {
  const t = useI18n()
  const [, setTick] = useState(0)
  // one zoom for tabs, messages and results grid (ResultViewer reads the same 'output' level)
  const sectionZoom = useSqlSectionZoom<HTMLElement>('output')
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setTick(value => value + 1), 200)
    return () => window.clearInterval(timer)
  }, [running])

  const elapsed = running ? Math.max(0, Date.now() - running.startedAt) : 0
  const latest = messages.at(-1)
  const progressText = running
    ? t('Executing {verb} on {database} · {s} s · previous results remain visible', { verb: running.verb, database: running.database || 'server', s: (elapsed / 1000).toFixed(1) })
    : latest?.tone === 'error'
      ? latest.text
      : execution
        ? (execution.totalRowCount === 1
          ? t('Completed · 1 row · {ms} ms', { ms: execution.elapsedMs })
          : t('Completed · {n} rows · {ms} ms', { n: execution.totalRowCount, ms: execution.elapsedMs }))
        : t('Ready')

  return (
    <section ref={sectionZoom.ref} className="sql-query-output" aria-label={t('SQL query output')} style={{ ...sectionZoom.style, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="sql-query-output__tabs" role="tablist" aria-label={t('query output')} style={{
        height: 29, display: 'flex', alignItems: 'stretch', flexShrink: 0,
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderBottom: 0,
        borderRadius: 'var(--radius-md) var(--radius-md) 0 0'
      }}>
        <button role="tab" aria-selected={selected === 'results'} onClick={() => onSelected('results')} style={tabStyle(selected === 'results')}>
          <Table2 size={10} /> {t('Results')}
        </button>
        <button role="tab" aria-selected={selected === 'messages'} onClick={() => onSelected('messages')} style={tabStyle(selected === 'messages')}>
          <MessageSquareText size={10} /> {t('Messages')}{messages.length > 0 ? ` · ${messages.length}` : ''}
        </button>
        <div className={`sql-query-output__status ${running ? 'is-running' : ''}`} data-testid="sql-query-progress" aria-live="polite" style={{
          marginLeft: 'auto', minWidth: 0, padding: '0 9px', display: 'flex', alignItems: 'center', gap: 6,
          color: running ? 'var(--accent-color)' : latest?.tone === 'error' ? 'var(--error-color)' : 'var(--text-muted)',
          fontFamily: 'var(--font-mono)', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontVariantNumeric: 'tabular-nums'
        }}>
          {running
            ? <Loader2 size={10} style={{ animation: 'spin 0.9s linear infinite', flexShrink: 0 }} />
            : latest?.tone === 'error'
              ? <AlertCircle size={10} style={{ flexShrink: 0 }} />
              : execution ? <Check size={10} style={{ color: 'var(--success-color)', flexShrink: 0 }} /> : <Clock3 size={10} style={{ flexShrink: 0 }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{progressText}</span>
        </div>
      </div>

      {selected === 'results' ? (
        <div role="tabpanel" aria-label={t('Results')} style={{ flex: 1, minHeight: 0, display: 'flex' }}>{children}</div>
      ) : (
        <div role="tabpanel" aria-label={t('Messages')} style={{
          flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 12px',
          background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '0 0 var(--radius-md) var(--radius-md)',
          fontFamily: 'var(--font-mono)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', lineHeight: 1.65
        }}>
          {messages.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>{t('No messages for this query tab.')}</div>
          ) : messages.map(message => (
            <div key={message.id} style={{ display: 'grid', gridTemplateColumns: '68px minmax(0, 1fr)', gap: 9, color: message.tone === 'error' ? 'var(--error-color)' : message.tone === 'success' ? 'var(--success-color)' : 'var(--text-secondary)' }}>
              <time style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {new Date(message.at).toLocaleTimeString([], { hour12: false })}
              </time>
              <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
