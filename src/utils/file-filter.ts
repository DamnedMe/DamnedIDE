// File-name filter shared by the file trees (Files, explorer) and Worktree > Changes.
// Pure: no React, no electron.

export type FileFilterMode = 'startsWith' | 'like' | 'regex'

export interface FileFilter {
  query: string
  mode: FileFilterMode
  caseSensitive: boolean
  spaceSensitive: boolean
}

/**
 * Compiles a filter into a matcher, building the RegExp once instead of per row.
 * Whitespace is dropped from both sides unless spaceSensitive; the regex keeps
 * the pattern as typed and uses the 'i' flag (lowercasing the pattern would turn
 * \S \W \D \B into \s \w \d \b). An invalid regex falls back to substring.
 * A null filter or an empty query matches everything.
 */
export function compileFileFilter(f: FileFilter | null): (target: string) => boolean {
  if (!f) return () => true
  const norm = (s: string) => f.spaceSensitive ? s : s.replace(/\s+/g, '')
  const fold = (s: string) => norm(f.caseSensitive ? s : s.toLowerCase())
  const q = fold(f.query)
  if (!q) return () => true
  if (f.mode === 'startsWith') return (t) => fold(t).startsWith(q)
  if (f.mode === 'regex') {
    try {
      const re = new RegExp(norm(f.query), f.caseSensitive ? '' : 'i')
      return (t) => re.test(norm(t))
    } catch { /* invalid pattern: substring below */ }
  }
  return (t) => fold(t).includes(q)
}

/** For a relative path: the file name alone (`^Foo`) or the whole path (`^src/Api/`) may match. */
export const matchPathOrName = (match: (target: string) => boolean) =>
  (path: string): boolean => match(path) || match(path.slice(path.lastIndexOf('/') + 1))
