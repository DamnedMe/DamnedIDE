import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CalendarDays, Clock, Check, X, Ban } from 'lucide-react'
import { formatGridDate, parseDateText } from './sqlForm'

interface DateTimePickerProps {
  value: string
  /** receives the new value in the grid's text format */
  onChange: (text: string) => void
  onClose: () => void
  /** offers a "NULL" action */
  allowNull?: boolean
  x?: number
  y?: number
}

const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

// Monday-first offset (0 = Monday)
function firstWeekdayOffset(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// Compact calendar + time picker; the value travels as the grid's text format so
// a picked date looks exactly like the rest of the column.
export function DateTimePicker({ value, onChange, onClose, allowNull, x, y }: DateTimePickerProps) {
  const initial = useMemo(() => parseDateText(value) || new Date(), [value])
  const [date, setDate] = useState<Date>(initial)
  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() })
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Enter') { e.preventDefault(); commit() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const commit = () => { onChange(formatGridDate(date)); onClose() }

  const setPart = (patch: { y?: number; mo?: number; d?: number; h?: number; mi?: number; s?: number }) => {
    setDate(prev => {
      const next = new Date(prev)
      if (patch.y !== undefined) next.setFullYear(patch.y)
      if (patch.mo !== undefined) next.setMonth(patch.mo)
      if (patch.d !== undefined) next.setDate(patch.d)
      if (patch.h !== undefined) next.setHours(patch.h)
      if (patch.mi !== undefined) next.setMinutes(patch.mi)
      if (patch.s !== undefined) next.setSeconds(patch.s)
      return next
    })
  }

  const moveMonth = (delta: number) => {
    setView(prev => {
      const d = new Date(prev.year, prev.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  const days = useMemo(() => {
    const total = daysInMonth(view.year, view.month)
    const offset = firstWeekdayOffset(view.year, view.month)
    const cells: (Date | null)[] = []
    for (let i = 0; i < offset; i++) cells.push(null)
    for (let d = 1; d <= total; d++) cells.push(new Date(view.year, view.month, d))
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [view])

  const today = new Date()
  const left = Math.max(8, Math.min(x ?? window.innerWidth / 2 - 135, window.innerWidth - 278))
  const top = Math.max(8, Math.min(y ?? window.innerHeight / 2 - 180, window.innerHeight - 330))

  const timeInput = (label: string, value2: number, max2: number, onSet: (v: number) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>
      {label}
      <input
        type="number" min={0} max={max2} value={String(value2).padStart(2, '0')}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onSet(Math.max(0, Math.min(max2, Math.trunc(n))))
        }}
        style={{
          width: '42px', background: 'var(--bg-input)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', padding: '2px 4px',
          fontFamily: 'var(--font-mono)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', outline: 'none'
        }}
      />
    </label>
  )

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="date and time picker"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left, top, zIndex: 400, width: '270px',
        background: 'var(--bg-card)', border: '1px solid var(--accent-color)',
        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
        fontFamily: 'var(--font-mono)', animation: 'menuIn 140ms ease', userSelect: 'none'
      }}
    >
      {/* header: month navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
        <CalendarDays size={12} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
        <button onClick={() => setView(v => ({ ...v, year: v.year - 1 }))} title="anno precedente" data-tip-desc="previous year" style={navBtn}>
          <ChevronsLeft size={12} />
        </button>
        <button onClick={() => moveMonth(-1)} title="mese precedente" data-tip-desc="previous month" style={navBtn}>
          <ChevronLeft size={12} />
        </button>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 'calc(10.5px * var(--ui-text-scale, 1))', color: 'var(--text-primary)', fontWeight: 600 }}>
          {MONTHS[view.month]} {view.year}
        </span>
        <button onClick={() => moveMonth(1)} title="mese successivo" data-tip-desc="next month" style={navBtn}>
          <ChevronRight size={12} />
        </button>
        <button onClick={() => setView(v => ({ ...v, year: v.year + 1 }))} title="anno successivo" data-tip-desc="next year" style={navBtn}>
          <ChevronsRight size={12} />
        </button>
      </div>

      {/* calendar */}
      <div style={{ padding: '6px 8px 2px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
          {WEEKDAYS.map(d => (
            <span key={d} style={{ textAlign: 'center', fontSize: 'calc(8px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', padding: '1px 0' }}>
              {d}
            </span>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginTop: '2px' }}>
          {days.map((day, i) => {
            if (!day) return <span key={`e${i}`} />
            const selected = sameDay(day, date)
            const isToday = sameDay(day, today)
            return (
              <button
                key={day.getTime()}
                onClick={() => setPart({ y: day.getFullYear(), mo: day.getMonth(), d: day.getDate() })}
                onDoubleClick={commit}
                style={{
                  height: '22px', padding: 0, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  border: `1px solid ${selected ? 'var(--accent-color)' : isToday ? 'var(--border-color)' : 'transparent'}`,
                  background: selected ? 'var(--accent-color)' : 'transparent',
                  color: selected ? 'var(--text-inverse)' : isToday ? 'var(--accent-color)' : 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)', fontSize: 'calc(9.5px * var(--ui-text-scale, 1))',
                  fontWeight: selected || isToday ? 700 : 400
                }}
                onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent' }}
              >
                {day.getDate()}
              </button>
            )
          })}
        </div>
      </div>

      {/* time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <Clock size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        {timeInput('h', date.getHours(), 23, (v) => setPart({ h: v }))}
        {timeInput('m', date.getMinutes(), 59, (v) => setPart({ mi: v }))}
        {timeInput('s', date.getSeconds(), 59, (v) => setPart({ s: v }))}
        <button
          onClick={() => setDate(new Date())}
          title="usa data e ora attuali" data-tip-desc="set the current date and time"
          style={{
            padding: '2px 8px', height: '20px', background: 'var(--bg-card)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)', cursor: 'pointer',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
          }}
        >
          adesso
        </button>
      </div>

      {/* actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 8px', borderTop: '1px solid var(--border-subtle)' }}>
        {allowNull && (
          <button
            onClick={() => { onChange('NULL'); onClose() }}
            title="inserisci NULL" data-tip-desc="set the value to NULL"
            style={{ ...actionBtn, color: 'var(--text-muted)' }}
          >
            <Ban size={10} /> null
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} title="annulla" data-tip-desc="close without changing the value" style={actionBtn}>
          <X size={10} /> annulla
        </button>
        <button
          onClick={commit}
          title="conferma" data-tip-desc="apply the picked date and time"
          style={{ ...actionBtn, background: 'var(--accent-color)', borderColor: 'var(--accent-color)', color: 'var(--text-inverse)', fontWeight: 700 }}
        >
          <Check size={10} /> ok
        </button>
      </div>
    </div>
  )
}

const navBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '20px', height: '20px', padding: 0, background: 'transparent',
  border: 'none', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 'var(--radius-sm)'
}

const actionBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 9px', height: '22px',
  background: 'var(--bg-card)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
  cursor: 'pointer', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
}
