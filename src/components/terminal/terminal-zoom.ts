// Terminal zoom: one global font size (settings.terminalFontSize) for every
// xterm. No imports, so scripts/terminal.check.ts can load it from node.

export const TERMINAL_FONT_DEFAULT = 12
export const TERMINAL_FONT_MIN = 8
export const TERMINAL_FONT_MAX = 32

export type TerminalZoom = 'in' | 'out' | 'reset'

/** Ctrl/Cmd + '+' '=' numpad Add / '-' numpad Subtract / '0'; AltGr (Ctrl+Alt) is not a zoom. */
export function terminalZoomKey(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; key: string }): TerminalZoom | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  if (e.key === '+' || e.key === '=' || e.key === 'Add') return 'in'
  if (e.key === '-' || e.key === 'Subtract') return 'out'
  if (e.key === '0') return 'reset'
  return null
}

/** One px per step, clamped to 8-32; reset returns the 12px default. */
export function nextTerminalFontSize(current: number, z: TerminalZoom): number {
  if (z === 'reset') return TERMINAL_FONT_DEFAULT
  const n = Math.round(current) + (z === 'in' ? 1 : -1)
  return Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, n))
}
