import { useEffect, useRef, useState } from 'react'

// Global delegated tooltip: upgrades every native `title` (and `data-tip`)
// into a styled tooltip that appears in ~350ms (about half the browser default)
// and can carry a longer description via `data-tip-desc`. Native tooltips are
// suppressed while the styled one is shown.
//
// Two mechanisms keep the native tooltip away:
// - a delegated `mouseover` listener schedules the tooltip on hover;
// - a global MutationObserver catches elements that gain a `title` while the
//   cursor is already over them without a new `mouseover` (context menus that
//   open under the cursor, React remounts, re-renders that re-apply `title`).
interface TipState {
  text: string
  desc?: string
}

const DELAY_MS = 350

export function TooltipHost() {
  const [tip, setTip] = useState<TipState | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const lastPosRef = useRef<{ x: number; y: number }>({ x: -100, y: -100 })
  const stateRef = useRef<{ el: HTMLElement | null; timer: number | undefined }>({ el: null, timer: undefined })

  const position = () => {
    if (!tipRef.current) return
    const { x: cx, y: cy } = lastPosRef.current
    const pad = 10
    const tw = tipRef.current.offsetWidth
    const th = tipRef.current.offsetHeight
    let x = cx + 12
    let y = cy + 14
    if (x + tw > window.innerWidth - pad) x = cx - tw - 12
    if (y + th > window.innerHeight - pad) y = cy - th - 14
    if (x < pad) x = pad
    if (y < pad) y = pad
    tipRef.current.style.left = `${x}px`
    tipRef.current.style.top = `${y}px`
  }

  // position as soon as the tooltip is rendered (the mouse may be still)
  useEffect(() => {
    if (!tip) return
    const id = requestAnimationFrame(position)
    return () => cancelAnimationFrame(id)
  }, [tip])

  useEffect(() => {
    const readText = (node: HTMLElement) => {
      const title = node.hasAttribute('title') ? node.getAttribute('title') : null
      const data = node.dataset.tip
      const text = (data || title || '').trim()
      const desc = (node.dataset.tipDesc || '').trim()
      return text ? { text, desc: desc || undefined } : null
    }

    const restoreTitle = (node: HTMLElement) => {
      if (node.dataset._title) {
        node.setAttribute('title', node.dataset._title)
        delete node.dataset._title
      }
    }

    const hide = () => {
      const s = stateRef.current
      if (s.timer) { clearTimeout(s.timer); s.timer = undefined }
      if (s.el) {
        restoreTitle(s.el)
        s.el = null
      }
      setTip(null)
    }

    const schedule = (node: HTMLElement) => {
      const s = stateRef.current
      if (node === s.el) return
      hide()
      s.el = node
      // read the tooltip content BEFORE suppressing the native title, so that
      // title-only elements (no data-tip) still get the styled tooltip
      const content = readText(node)
      if (!content) { hide(); return }
      if (node.hasAttribute('title')) {
        node.dataset._title = node.getAttribute('title') || ''
        node.removeAttribute('title')
      }
      // elements can request a longer delay (e.g. file names: 1000ms) so the
      // tooltip does not flash while scanning a list
      const delay = Number(node.dataset.tipDelay) || DELAY_MS
      s.timer = window.setTimeout(() => setTip(content), delay)
    }

    // the element that currently has the tooltip semantics under the cursor.
    // The active element's `title` is suppressed while hovering, so it must be
    // matched by containment rather than by the `[title]` selector.
    const nodeUnderCursor = () => {
      const { x, y } = lastPosRef.current
      if (x < 0 || y < 0) return null
      const under = document.elementFromPoint(x, y) as HTMLElement | null
      if (!under) return null
      const active = stateRef.current.el
      if (active && (under === active || active.contains(under))) return active
      return under.closest('[title],[data-tip]') as HTMLElement | null
    }

    const onOver = (e: MouseEvent) => {
      // mousemove fires AFTER mouseover, so the MutationObserver microtask that
      // runs right after this event would see a stale position: store it here
      lastPosRef.current = { x: e.clientX, y: e.clientY }
      const node = (e.target as HTMLElement)?.closest?.('[title],[data-tip]') as HTMLElement | null
      if (!node) { hide(); return }
      schedule(node)
    }
    const onMove = (e: MouseEvent) => {
      lastPosRef.current = { x: e.clientX, y: e.clientY }
      if (stateRef.current.el) position()
    }
    const onOut = (e: MouseEvent) => {
      lastPosRef.current = { x: e.clientX, y: e.clientY }
      const s = stateRef.current
      if (!s.el) return
      const related = e.relatedTarget as HTMLElement | null
      if (related && s.el.contains(related)) return
      // relatedTarget can be null in edge cases (window blur, element swapped):
      // fall back to the element actually under the pointer before hiding
      const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      if (under && s.el.contains(under)) return
      hide()
    }

    // Safety net for changes that happen under a stationary cursor: a context
    // menu opening at the click position, a React remount, or a re-render that
    // re-applies `title` — none of these fire a `mouseover`, and without this
    // observer the native browser tooltip would appear.
    const globalObs = new MutationObserver(() => {
      const node = nodeUnderCursor()
      if (node && node === stateRef.current.el) {
        // same element: keep its `title` suppressed (React may have re-added it)
        if (node.hasAttribute('title')) node.removeAttribute('title')
        return
      }
      if (node) schedule(node)
      else hide()
    })
    globalObs.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title', 'data-tip', 'data-tip-desc']
    })

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseout', onOut)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseout', onOut)
      globalObs.disconnect()
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
