import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { useSettingsStore, useSqlZoomStore } from '../../store'
import { uiTextScale } from '../../utils/fonts'
import { clampSqlZoom, sqlZoomBounds, stepSqlZoom } from './sqlZoom'
import type { SqlZoomSection } from '../../types/sql'

/**
 * Ctrl/Cmd+wheel zooms one SQL workbench section and Ctrl/Cmd+0 resets it.
 * Attach `ref` and `style` to the section root: the style overrides
 * --ui-text-scale there, so every calc(Npx * var(--ui-text-scale)) inside
 * follows the section zoom.
 *
 * The wheel listener is native, capture phase and non-passive: React's onWheel
 * is passive (preventDefault is ignored, so the window would zoom) and Monaco
 * scrolls on Ctrl+wheel and stops the event, so a bubble listener never sees it.
 */
export function useSqlSectionZoom<T extends HTMLElement>(section: SqlZoomSection) {
  const ref = useRef<T | null>(null)
  const fontSize = useSettingsStore(s => s.settings.fontSize)
  const storedZoom = useSqlZoomStore(s => s[section])
  const zoom = clampSqlZoom(storedZoom, sqlZoomBounds(fontSize))

  useEffect(() => {
    const element = ref.current
    if (!element) return
    // ponytail: one 10% step per wheel event, like the diagram zoom; a precision-touchpad
    // pinch sends many small events and zooms fast (fix: accumulate deltaY up to ~50)
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return
      event.preventDefault()
      event.stopPropagation()
      const store = useSqlZoomStore.getState()
      const bounds = sqlZoomBounds(useSettingsStore.getState().settings.fontSize)
      store.setZoom(section, stepSqlZoom(clampSqlZoom(store[section], bounds), event.deltaY < 0 ? 1 : -1, bounds))
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key !== '0') return
      event.preventDefault()
      event.stopPropagation()
      useSqlZoomStore.getState().setZoom(section, 1)
    }
    element.addEventListener('wheel', onWheel, { capture: true, passive: false })
    element.addEventListener('keydown', onKeyDown, true)
    return () => {
      element.removeEventListener('wheel', onWheel, { capture: true })
      element.removeEventListener('keydown', onKeyDown, true)
    }
  }, [section])

  const style = { '--ui-text-scale': String(uiTextScale(fontSize) * zoom) } as CSSProperties
  return { ref, zoom, style }
}
