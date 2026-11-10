import { useToastStore } from '../../store'
import { CheckCircle2, XCircle, Info, X } from '@/components/icons'
import { useI18n } from '../../i18n'

export function ToastHost() {
  const { toasts, removeToast } = useToastStore()
  const t = useI18n()

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: '16px', right: '16px', zIndex: 10000,
      display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '340px'
    }}>
      {toasts.map((toast) => {
        const color = toast.type === 'success' ? 'var(--success-color)' : toast.type === 'error' ? 'var(--error-color)' : 'var(--info-color)'
        const Icon = toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? XCircle : Info
        return (
          <div key={toast.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: '8px',
            background: 'var(--bg-card)', border: `1px solid ${color}`,
            borderRadius: 'var(--radius-md)', padding: '10px 12px',
            boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--font-mono)',
            animation: 'fadeIn 0.15s ease'
          }}>
            <Icon size={14} style={{ color, flexShrink: 0, marginTop: '1px' }} />
            <span style={{ flex: 1, fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-primary)', lineHeight: 1.4 }}>{toast.message}</span>
            <button onClick={() => removeToast(toast.id)} title={t('dismiss')} data-tip-desc={t('dismiss this notification')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', padding: '1px', flexShrink: 0
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
              <X size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
