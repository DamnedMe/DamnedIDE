// Renderer-side path helpers (no node integration available).
// Absolute filesystem paths must use the separator of their base: Windows
// drives (`C:\...`) and UNC roots (`\\server\share`) use `\`, everything else
// uses `/`. Git-relative paths always keep `/`.

const WINDOWS_ROOT = /^[A-Za-z]:[\\/]/
const UNC_ROOT = /^\\\\/

/** Convert every backslash to a forward slash (useful for comparisons). */
export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Split a path on any run of `/` or `\`, dropping empty segments. */
export function splitPath(p: string): string[] {
  return p.split(/[\\/]+/).filter(Boolean)
}

/** Last segment of a path (`C:\a\b.ts` → `b.ts`, `/home/u/` → `u`). */
export function basenameOf(p: string): string {
  const parts = splitPath(p)
  return parts.length > 0 ? parts[parts.length - 1] : p
}

/** Separator implied by a path: `\` only for drive-letter or UNC roots. */
export function sepFor(p: string): '\\' | '/' {
  return WINDOWS_ROOT.test(p) || UNC_ROOT.test(p) ? '\\' : '/'
}

function normalizeSep(p: string, sep: string): string {
  const collapsed = p.replace(/[\\/]+/g, sep)
  // the collapse would eat the leading "\\" of a UNC root: put it back
  return sep === '\\' && p.startsWith('\\\\') ? sep + collapsed : collapsed
}

/**
 * Join path pieces with the separator implied by the base (or by the first
 * non-empty piece when the base is empty), without duplicating separators.
 * Separators inside the pieces are normalized to the chosen one.
 */
export function joinPath(base: string, ...parts: string[]): string {
  const pieces = [base, ...parts].filter(p => !!p)
  if (pieces.length === 0) return ''
  const sep = sepFor(pieces[0])
  let result = normalizeSep(pieces[0], sep)
  const trimmed = result.replace(/[\\/]+$/, '')
  result = trimmed || (result ? sep : '')
  for (const piece of pieces.slice(1)) {
    const part = normalizeSep(piece, sep).replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
    if (!part) continue
    result = result.endsWith(sep) ? result + part : result + sep + part
  }
  return result
}

/** Parent directory of a path, preserving the root (`C:\file` → `C:\`). */
export function dirnameOf(p: string): string {
  const clean = p.replace(/[\\/]+$/, '')
  const idx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  if (idx < 0) return ''
  if (idx === 0) return clean.slice(0, 1)
  if (WINDOWS_ROOT.test(clean) && idx === 2) return clean.slice(0, 3)
  return clean.slice(0, idx)
}

/**
 * Compare two paths after slash normalization; case-insensitive only when one
 * of them looks like a Windows path (drive letter or UNC).
 */
export function samePath(a: string, b: string): boolean {
  if (!a || !b) return a === b
  const windows = WINDOWS_ROOT.test(a) || UNC_ROOT.test(a) || WINDOWS_ROOT.test(b) || UNC_ROOT.test(b)
  const na = normalizeSlashes(a)
  const nb = normalizeSlashes(b)
  return windows ? na.toLowerCase() === nb.toLowerCase() : na === nb
}
