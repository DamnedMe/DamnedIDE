export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function hexToRgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex)
  if (!c) return `rgba(0, 255, 255, ${alpha})`
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`
}

// WCAG relative luminance (0 = black, 1 = white)
export function relativeLuminance(hex: string): number {
  const c = hexToRgb(hex)
  if (!c) return 0
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}
