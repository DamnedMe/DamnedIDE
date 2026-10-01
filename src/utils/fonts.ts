// Global application font: one family for the whole IDE (UI, SQL, editors,
// terminal). The Google Fonts are fetched on demand (and simply fall back to the
// monospace stack when the machine is offline).

export const DEFAULT_APP_FONT = 'Nunito'

export const MONO_FALLBACK = "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace"

export interface AppFontChoice {
  value: string
  label: string
  google?: boolean
}

// `JetBrains Mono` is the font the IDE used before this setting: it stays in the
// list so the old look is one click away.
export const APP_FONT_CHOICES: AppFontChoice[] = [
  { value: 'Nunito', label: 'Nunito', google: true },
  { value: 'JetBrains Mono', label: 'JetBrains Mono', google: true },
  { value: 'Inter', label: 'Inter', google: true },
  { value: 'Roboto', label: 'Roboto', google: true },
  { value: 'Open Sans', label: 'Open Sans', google: true },
  { value: 'Lato', label: 'Lato', google: true },
  { value: 'Montserrat', label: 'Montserrat', google: true },
  { value: 'Fira Sans', label: 'Fira Sans', google: true },
  { value: 'Source Sans 3', label: 'Source Sans 3', google: true }
]

const GOOGLE_FONTS = new Set(APP_FONT_CHOICES.filter(c => c.google).map(c => c.value))

/** Full CSS font stack for the selected family (family first, mono fallback). */
export function appFontStack(family: string): string {
  const name = (family || DEFAULT_APP_FONT).trim().replace(/'/g, '')
  return `'${name}', ${MONO_FALLBACK}`
}

/**
 * Injects the Google Fonts stylesheet for a known family, once. Unknown
 * families (user-added, or installed system fonts) are left to the OS.
 */
export function ensureFontLoaded(family: string): void {
  const name = (family || '').trim()
  if (!name || !GOOGLE_FONTS.has(name)) return
  const id = `app-font-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}:wght@400;600;700&display=swap`
  document.head.appendChild(link)
}
