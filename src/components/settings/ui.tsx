import { Children, Fragment, isValidElement, useState } from 'react'
import type { CSSProperties, ReactNode, ButtonHTMLAttributes } from 'react'
import { AlertCircle, AlertTriangle, Check, Info, Loader2 } from '@/components/icons'

// Building blocks of the settings pages: page header, cards with rows, inputs,
// buttons, chips and notices. Inline styles + theme tokens, like the rest of the IDE.

/** `calc(Npx * var(--ui-text-scale, 1))` */
export const px = (n: number): string => `calc(${n}px * var(--ui-text-scale, 1))`

/** Electron prefixes IPC rejections with "Error invoking remote method 'x': Error:" */
export function ipcMessage(e: unknown, fallback = 'operazione fallita'): string {
  const raw = (e as Error)?.message || (typeof e === 'string' ? e : '')
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim() || fallback
}

export const spin: CSSProperties = { animation: 'spin 1s linear infinite' }

export function PageHeader({ icon, group, title, description }: {
  icon: ReactNode
  group?: string
  title: string
  description: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '2px 0 6px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: px(32), height: px(32), borderRadius: 'var(--radius-md)',
        background: 'var(--accent-bg)', color: 'var(--accent-color)'
      }}>
        {icon}
      </div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {group && (
          <div style={{
            fontSize: px(9), color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700
          }}>
            {group}
          </div>
        )}
        <h2 style={{ fontSize: px(15), fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', lineHeight: 1.25 }}>
          {title}
        </h2>
        <div style={{ fontSize: px(10.5), color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
          {description}
        </div>
      </div>
    </div>
  )
}

/**
 * A card: optional header (title, description, actions on the right), then its
 * children as rows separated by a thin divider.
 */
export function Card({ title, icon, description, actions, accent, children }: {
  title?: ReactNode
  icon?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** highlighted border (current folder, form being edited) */
  accent?: boolean
  children?: ReactNode
}) {
  // toArray already drops null, undefined and booleans
  const items = Children.toArray(children).filter(c => c !== '')
  const hasHeader = !!(title || description || actions)
  return (
    <section style={{
      background: 'var(--bg-card)',
      border: `1px solid ${accent ? 'var(--accent-color)' : 'var(--border-color)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: accent ? '0 0 0 3px var(--accent-glow)' : undefined,
      display: 'flex', flexDirection: 'column', minWidth: 0
    }}>
      {hasHeader && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap',
          padding: '10px 12px',
          borderBottom: items.length > 0 ? '1px solid var(--border-subtle)' : undefined
        }}>
          <div style={{ minWidth: 0, flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {title && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0,
                fontSize: px(11.5), fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)'
              }}>
                {icon && <span style={{ display: 'flex', color: 'var(--accent-color)', flexShrink: 0 }}>{icon}</span>}
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
              </div>
            )}
            {description && (
              <div style={{ fontSize: px(9.5), color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.55 }}>
                {description}
              </div>
            )}
          </div>
          {actions && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>{actions}</div>}
        </div>
      )}
      {items.map((child, i) => (
        <Fragment key={isValidElement(child) && child.key != null ? child.key : i}>
          {i > 0 && <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '0 12px' }} />}
          {child}
        </Fragment>
      ))}
    </section>
  )
}

/** One setting: icon + label (+ hint below) on the left, the control on the right; wraps when narrow. */
export function Row({ icon, label, hint, children, align = 'center' }: {
  icon?: ReactNode
  label: ReactNode
  hint?: ReactNode
  children?: ReactNode
  align?: 'center' | 'flex-start'
}) {
  return (
    <div style={{
      display: 'flex', alignItems: align, justifyContent: 'space-between', flexWrap: 'wrap',
      gap: '8px 16px', padding: '9px 12px', minWidth: 0
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', minWidth: 0, flex: '1 1 180px' }}>
        {icon && <span style={{ display: 'flex', color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }}>{icon}</span>}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span style={{ fontSize: px(11), color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{label}</span>
          {hint && (
            <span style={{ fontSize: px(9.5), color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>{hint}</span>
          )}
        </div>
      </div>
      {children !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0, maxWidth: '100%' }}>
          {children}
        </div>
      )}
    </div>
  )
}

/** Free content inside a card (forms, lists) with the row padding. */
export function CardBody({ children, gap = 8 }: { children: ReactNode; gap?: number }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: `${gap}px`, padding: '10px 12px', minWidth: 0 }}>{children}</div>
}

export function Toggle({ checked, onChange, title, tip }: { checked: boolean; onChange: (v: boolean) => void; title?: string; tip?: string }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} title={title} data-tip-desc={tip} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
      width: '32px', height: '16px', borderRadius: '10px', border: 'none',
      background: checked ? 'var(--accent-color)' : 'var(--bg-disabled)',
      cursor: 'pointer', transition: 'background 0.15s ease', flexShrink: 0
    }}>
      <div style={{
        width: '12px', height: '12px', borderRadius: '50%',
        background: checked ? 'var(--text-inverse)' : 'var(--text-muted)',
        marginLeft: checked ? '18px' : '2px',
        transition: 'margin 0.15s ease, background 0.15s ease'
      }} />
    </button>
  )
}

export const controlStyle: CSSProperties = {
  background: 'var(--bg-input)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
  fontSize: px(10.5), fontFamily: 'var(--font-mono)', outline: 'none',
  minHeight: px(26), minWidth: 0, maxWidth: '100%'
}

export const inputStyle: CSSProperties = { ...controlStyle, padding: '0 8px', width: '100%' }

export function SelectInput({ value, options, onChange, title, tip, style }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  title?: string
  tip?: string
  style?: CSSProperties
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title={title} data-tip-desc={tip}
      style={{ ...controlStyle, padding: '0 6px', cursor: 'pointer', ...style }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

/** Range with its value next to it. */
export function RangeInput({ min, max, step, value, onChange, unit = 'px', title, tip }: {
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  unit?: string
  title?: string
  tip?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input type="range" min={String(min)} max={String(max)} step={String(step)} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} title={title} data-tip-desc={tip}
        style={{ width: px(120), maxWidth: '40vw', accentColor: 'var(--accent-color)', cursor: 'pointer' }} />
      <span style={{
        fontSize: px(10.5), fontFamily: 'var(--font-mono)', color: 'var(--accent-color)', fontWeight: 600,
        minWidth: px(36), textAlign: 'right', fontVariantNumeric: 'tabular-nums'
      }}>
        {value}{unit}
      </span>
    </div>
  )
}

export function ColorInput({ value, onChange, title, tip }: { value: string; onChange: (v: string) => void; title?: string; tip?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} title={title} data-tip-desc={tip}
        style={{ width: '30px', height: '22px', padding: 0, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }} />
      <span style={{ fontSize: px(10), fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', minWidth: px(56), textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

export function ThemeBtn({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active} style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '0 14px', minHeight: px(28),
      background: active ? 'var(--accent-bg)' : 'var(--bg-subtle)',
      border: active ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
      borderRadius: 'var(--radius-sm)',
      color: active ? 'var(--accent-color)' : 'var(--text-muted)',
      cursor: 'pointer', fontSize: px(10.5), fontFamily: 'var(--font-mono)',
      fontWeight: active ? 600 : 500, transition: 'all 0.15s ease'
    }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--text-muted)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--border-color)' }}>
      {icon}
      {label}
    </button>
  )
}

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'subtle'

/** primary: accent filled; ghost: neutral outline; danger: red outline; subtle: borderless link-like. */
export function Btn({ variant = 'ghost', children, style, onMouseEnter, onMouseLeave, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const [hover, setHover] = useState(false)
  const disabled = !!rest.disabled
  const on = hover && !disabled
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
    padding: '0 11px', minHeight: px(26), borderRadius: 'var(--radius-sm)',
    fontSize: px(10), fontFamily: 'var(--font-mono)', fontWeight: 600, whiteSpace: 'nowrap',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'border-color 0.15s ease, color 0.15s ease, background 0.15s ease, filter 0.15s ease'
  }
  const look: Record<BtnVariant, CSSProperties> = {
    primary: {
      background: disabled ? 'var(--bg-disabled)' : 'var(--accent-color)', border: '1px solid transparent',
      color: disabled ? 'var(--text-muted)' : 'var(--text-inverse)', filter: on ? 'brightness(1.12)' : undefined
    },
    ghost: {
      background: 'var(--bg-subtle)', border: `1px solid ${on ? 'var(--accent-color)' : 'var(--border-color)'}`,
      color: disabled ? 'var(--text-muted)' : on ? 'var(--accent-color)' : 'var(--text-secondary)'
    },
    danger: {
      background: on ? 'var(--error-bg)' : 'transparent', border: `1px solid ${disabled ? 'var(--border-color)' : 'var(--error-color)'}`,
      color: disabled ? 'var(--text-muted)' : 'var(--error-color)'
    },
    subtle: {
      background: on ? 'var(--bg-hover)' : 'transparent', border: '1px solid transparent', padding: '0 6px',
      color: disabled ? 'var(--text-muted)' : 'var(--accent-color)'
    }
  }
  return (
    <button {...rest} style={{ ...base, ...look[variant], ...style }}
      onMouseEnter={(e) => { setHover(true); onMouseEnter?.(e) }}
      onMouseLeave={(e) => { setHover(false); onMouseLeave?.(e) }}>
      {children}
    </button>
  )
}

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'error'

const TONE: Record<Tone, { color: string; bg: string; border: string }> = {
  neutral: { color: 'var(--text-secondary)', bg: 'var(--bg-subtle)', border: 'var(--border-color)' },
  accent: { color: 'var(--accent-color)', bg: 'var(--accent-bg)', border: 'var(--accent-color)' },
  success: { color: 'var(--success-color)', bg: 'var(--success-bg)', border: 'var(--success-color)' },
  warning: { color: 'var(--warning-color)', bg: 'var(--warning-bg)', border: 'var(--warning-color)' },
  error: { color: 'var(--error-color)', bg: 'var(--error-bg)', border: 'var(--error-color)' }
}

export function Chip({ tone = 'neutral', icon, children, title, tip }: { tone?: Tone; icon?: ReactNode; children: ReactNode; title?: string; tip?: string }) {
  const t = TONE[tone]
  return (
    <span title={title} data-tip-desc={tip} style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '1px 7px',
      borderRadius: '999px', border: `1px solid ${t.border}`, background: t.bg, color: t.color,
      fontSize: px(9), fontFamily: 'var(--font-mono)', fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1.6
    }}>
      {icon}
      {children}
    </span>
  )
}

/** Inline message: info / ok / warning / error, with an optional action area. */
export function Notice({ tone = 'neutral', children, actions, icon }: {
  tone?: Exclude<Tone, 'accent'> | 'info'
  children: ReactNode
  actions?: ReactNode
  icon?: ReactNode
}) {
  const palette = tone === 'info'
    ? { color: 'var(--info-color)', bg: 'var(--info-bg)' }
    : tone === 'neutral' ? { color: 'var(--text-secondary)', bg: 'var(--bg-subtle)' } : { color: TONE[tone].color, bg: TONE[tone].bg }
  const glyph = icon ?? (tone === 'success' ? <Check size={12} />
    : tone === 'error' ? <AlertCircle size={12} />
      : tone === 'warning' ? <AlertTriangle size={12} /> : <Info size={12} />)
  return (
    <div role={tone === 'error' ? 'alert' : undefined} style={{
      display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap',
      padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: palette.bg,
      border: '1px solid var(--border-subtle)'
    }}>
      <span style={{ display: 'flex', color: palette.color, flexShrink: 0, marginTop: '2px' }}>{glyph}</span>
      <div style={{
        flex: '1 1 200px', minWidth: 0, fontSize: px(10), fontFamily: 'var(--font-mono)', lineHeight: 1.55,
        color: tone === 'neutral' || tone === 'info' ? 'var(--text-secondary)' : palette.color, wordBreak: 'break-word'
      }}>
        {children}
      </div>
      {actions && <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginLeft: 'auto' }}>{actions}</div>}
    </div>
  )
}

export function Loading({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', color: 'var(--text-muted)', fontSize: px(10), fontFamily: 'var(--font-mono)' }}>
      <Loader2 size={12} style={spin} /> {children}
    </div>
  )
}

/** Small uppercase heading between groups of cards on one page. */
export function SubHeading({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 2px 0' }}>
      <span style={{
        fontSize: px(9.5), fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase', letterSpacing: '0.6px'
      }}>
        {children}
      </span>
      {actions && <div style={{ display: 'flex', gap: '6px' }}>{actions}</div>}
    </div>
  )
}

/** `grow`: side by side with other fields in a wrapping row (in a column it would set a height). */
export function FieldLabel({ label, hint, grow, children }: { label: string; hint?: ReactNode; grow?: boolean; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: grow ? '1 1 180px' : undefined }}>
      <span style={{ fontSize: px(9.5), color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: px(9), color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>{hint}</span>}
    </label>
  )
}

/** Monospace path text that can be selected and wraps anywhere. */
export function PathText({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span style={{
      fontSize: px(10), fontFamily: 'var(--font-mono)', color: muted ? 'var(--text-muted)' : 'var(--text-primary)',
      wordBreak: 'break-all', userSelect: 'text'
    }}>
      {children}
    </span>
  )
}
