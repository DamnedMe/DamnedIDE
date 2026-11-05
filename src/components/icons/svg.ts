// Pure helpers behind the app icon set. No React import, so node checks can load them.

export interface ParsedSvg {
  viewBox: string
  /** inner markup of the root <svg> element */
  body: string
  /** the root's own fill (server-outline and wifi-outline set fill="none" there, not on their shapes) */
  fill?: string
}

/** Splits an SVG file (static package content) into its viewBox, root fill and inner markup. */
export function parseSvg(source: string): ParsedSvg {
  const match = /<svg\b([^>]*)>([\s\S]*)<\/svg>$/.exec(source.trim())
  if (!match || !match[2].trim()) throw new Error('invalid icon SVG')
  const viewBox = /\bviewBox="([^"]+)"/.exec(match[1])?.[1] ?? '0 0 512 512'
  const fill = /\sfill="([^"]+)"/.exec(match[1])?.[1]
  return fill ? { viewBox, body: match[2], fill } : { viewBox, body: match[2] }
}

/**
 * Converts a 24-grid stroke width (2 = default) to the Ionicons 512 grid,
 * where the default outline stroke is 32px: s → s * 16px. Undefined when not set or invalid.
 */
export function strokeWidthToCss(width: number | string | undefined): string | undefined {
  if (width == null || width === '') return undefined
  const value = typeof width === 'number' ? width : parseFloat(width)
  return Number.isFinite(value) && value >= 0 ? `${value * 16}px` : undefined
}
