import { useEffect, useRef, useState } from 'react'

// Global delegated tooltip: upgrades every native `title` (and `data-tip`)
// into a styled tooltip that appears in ~350ms (about half the browser default)
// and can carry a longer description via `data-tip-desc`. Native tooltips are
// suppressed while the styled one is shown.
interface TipState {
  text: string
  desc?: string
  x: number
  y: number
}

const DELAY_MS = 350

export function TooltipHost() {
  const [tip, setTip] = useState<TipState | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let el: HTMLElement | null = null
    let timer: number | undefined

    const readText = (node: HTMLElement) => {
      const title = node.hasAttribute('title') ? node.getAttribute('title') : null
      const data = node.dataset.tip
      const text = (data || title || '').trim()
      const desc = (node.dataset.tipDesc || '').trim()
      return text ? { text, desc: desc || undefined } : null
    }

    const hide = () => {
      if (timer) { clearTimeout(timer); timer = undefined }
      if (el) {
        if (el.dataset._title) {
          el.setAttribute('title', el.dataset._title)
          delete el.dataset._title
        }
        el = null
      }
      setTip(null)
    }

    const schedule = (node: HTMLElement) => {
      if (node === el) return
      hide()
      el = node
      // suppress the native tooltip while the styled one is active
      if (el.hasAttribute('title')) {
        el.dataset._title = el.getAttribute('title') || ''
        el.removeAttribute('title')
      }
      const content = readText(el)
      if (!content) { hide(); return }
      timer = window.setTimeout(() => setTip({
        text: content.text,
        desc: content.desc,
        x: 0,
        y: 0
      }), DELAY_MS)
    }

    const position = (e: MouseEvent) => {
      if (!tipRef.current) return
      const pad = 10
      const tw = tipRef.current.offsetWidth
      const th = tipRef.current.offsetHeight
      let x = e.clientX + 12
      let y = e.clientY + 14
      if (x + tw > window.innerWidth - pad) x = e.clientX - tw - 12
      if (y + th > window.innerHeight - pad) y = e.clientY - th - 14
      if (x < pad) x = pad
      if (y < pad) y = pad
      tipRef.current.style.left = `${x}px`
      tipRef.current.style.top = `${y}px`
    }

    const onOver = (e: MouseEvent) => {
      const node = (e.target as HTMLElement)?.closest?.('[title],[data-tip]') as HTMLElement | null
      if (!node) { hide(); return }
      schedule(node)
    }
    const onMove = (e: MouseEvent) => { if (el) position(e) }
    const onOut = (e: MouseEvent) => {
      if (!el) return
      const related = e.relatedTarget as HTMLElement | null
      if (related && el.contains(related)) return
      hide()
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseout', onOut)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseout', onOut)
      hide()
    }
  }, [])

  if (!tip) return null

  return (
    <div ref={tipRef} data-role="app-tooltip" style={{
      position: 'fixed', zIndex: 100000, pointerEvents: 'none',
      maxWidth: '360px', background: 'var(--bg-card)',
      border: '1px solid var(--accent-color)',
      borderRadius: 'var(--radius-sm)', padding: '6px 10px',
      boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--font-mono)',
      animation: 'menuIn 0.12s ease'
    }}>
      <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
        {tip.text}
      </div>
      {tip.desc && (
        <div style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', marginTop: '3px', lineHeight: 1.45 }}>
          {tip.desc}
        </div>
      )}
    </div>
  )
}
