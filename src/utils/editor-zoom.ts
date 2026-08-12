import { useSettingsStore } from '../store'

const MIN_FONT = 8
const MAX_FONT = 24
const STEP = 0.5

// Global font size is the single source of truth (settings → whole UI). Ctrl/Cmd+wheel
// (and the zoom controls) adjust that setting, so the settings slider and every editor
// (main, diff, worktree inspector) stay in sync.
export function adjustFontSize(deltaY: number) {
  const current = useSettingsStore.getState().settings.fontSize
  const next = Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round((current + (deltaY < 0 ? STEP : -STEP)) * 2) / 2))
  useSettingsStore.getState().updateSettings({ fontSize: next })
}

export function resetFontSize() {
  useSettingsStore.getState().updateSettings({ fontSize: 12.5 })
}

// Ctrl/Cmd+wheel scales the global font instead of Monaco's internal zoom, which
// would drift away from the setting. Returns a cleanup function.
export function attachWheelZoom(domNode: HTMLElement | null | undefined): () => void {
  if (!domNode) return () => {}
  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    e.stopPropagation()
    adjustFontSize(e.deltaY)
  }
  domNode.addEventListener('wheel', onWheel, { passive: false })
  return () => domNode.removeEventListener('wheel', onWheel)
}
