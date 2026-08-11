const DEF_KEYWORDS = /(class|struct|interface|enum|record|function|func|def|fn|async|public|private|protected|internal|static|readonly|abstract|sealed|virtual|override|export|import|type|namespace|package|module|let|const|var|using|impl|trait|pub|val|constructor|new|ref|out|this\.)/i

const SRC_EXT = /\.(cs|ts|tsx|js|jsx|java|go|rs|py|c|cpp|h|hpp|cshtml|razor|sql)$/i

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isCommentLine(line: string): boolean {
  return /^\s*(#|\/\/|\/\*|\*)/.test(line)
}

// The symbol sits right after an expression keyword → usage, not a declaration.
const USAGE_KW_END = /(?:^|\s)(await|return|throw|new|typeof|nameof|yield|default|case|ref|out|using)\s*$/i

// Usage signals in the text BEFORE the symbol: member access, call/argument context,
// assignment, lambda, string/object literal → the symbol is used, not declared.
function isUsageLine(line: string, symbol: string, before: string, nextLine: string): boolean {
  if (/[.(=,"'{]/.test(before)) return true
  if (before.includes('=>')) return true
  if (USAGE_KW_END.test(before)) return true
  if (before.trim() === '') {
    // The symbol is the first token on the line: it's a call statement (`Foo();`)
    // unless it opens a body/type after the parens (`Foo() {`, `Foo(): void {`,
    // `Foo() => x`) or the next line opens the body (Allman style).
    const decl = new RegExp(`\\b${escapeRegExp(symbol)}\\s*\\([^)]*\\)\\s*(?::|=>|\\{)`)
    if (decl.test(line)) return false
    if (nextLine.trim().startsWith('{')) return false
    return true
  }
  return false
}

/**
 * Scores a line as a candidate for definition/implementation of `symbol`.
 * Returns a number > 0 if it's a candidate, or -1 otherwise.
 * Usage lines (calls, assignments, member accesses) are rejected so F12/Ctrl+F12
 * always land on a real declaration, like Visual Studio.
 */
export function scoreLine(line: string, symbol: string, kind: 'definition' | 'implementation', nextLine = ''): number {
  if (!new RegExp(`\\b${escapeRegExp(symbol)}\\b`).test(line)) return -1
  if (isCommentLine(line)) return -1
  if (isUsageLine(line, symbol, line.split(symbol)[0], nextLine)) return -1
  const kw = DEF_KEYWORDS.test(line)
  const paren = new RegExp(`\\b${escapeRegExp(symbol)}\\s*\\(`).test(line)
  const brace = line.includes('{')
  const colonEq = new RegExp(`\\b${escapeRegExp(symbol)}\\s*[:=]`).test(line)
  const semi = new RegExp(`\\b${escapeRegExp(symbol)}\\s*;`).test(line)
  const arrow = line.includes('=>')
  const nextTrimmed = nextLine.trim()

  if (kind === 'implementation') {
    if (!paren) return -1
    if (semi) return -1                       // declaration (interface/abstract), not an implementation
    if (arrow && !kw) return -1               // expression/lambda, not a declaration
    if (brace) return 18 + (kw ? 5 : 0)       // `public void Foo() {`
    if (nextTrimmed.startsWith('{')) return 22 + (kw ? 5 : 0)  // Allman style
    return -1
  }

  if (kw) return 10 + (paren ? 3 : 0) + (brace ? 1 : 0) + (colonEq ? 2 : 0) + (semi ? 1 : 0)
  // interface / abstract member: prefer it for go-to-definition (DI-style, like VS)
  if (paren && semi && !brace) return 20
  if (paren && brace) return 8
  if (nextTrimmed.startsWith('{')) return 8   // Allman-style declaration
  if (colonEq) return 6
  if (semi) return 4
  return -1
}

/**
 * Returns the best line number (1-based) for the symbol in `lines`, excluding `excludeLine`.
 */
export function findBestLine(lines: string[], symbol: string, kind: 'definition' | 'implementation', excludeLine = 0): number {
  let bestScore = 0
  let bestLine = 0
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 === excludeLine) continue
    const score = scoreLine(lines[i], symbol, kind, lines[i + 1])
    if (score > bestScore) {
      bestScore = score
      bestLine = i + 1
    }
  }
  return bestLine
}

/**
 * Returns all 1-based line numbers (excluding `excludeLine` and comment lines)
 * where `symbol` appears — used for "find all references".
 */
export function findReferenceLines(lines: string[], symbol: string, excludeLine = 0): number[] {
  const re = new RegExp(`\\b${escapeRegExp(symbol)}\\b`)
  const result: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 === excludeLine) continue
    if (!re.test(lines[i])) continue
    if (isCommentLine(lines[i])) continue
    result.push(i + 1)
  }
  return result
}

export interface WorkspaceHit {
  file: string
  line: number
}

/**
 * Searches workspace files (bounded) for a definition/implementation of `symbol`.
 */
export async function searchWorkspaceFiles(rootPath: string, symbol: string, kind: 'definition' | 'implementation'): Promise<WorkspaceHit | null> {
  if (!rootPath) return null
  let files: string[]
  try {
    files = await window.electronAPI.fs.listFiles(rootPath, 3000)
  } catch {
    return null
  }
  let scanned = 0
  let best: WorkspaceHit | null = null
  let bestScore = 0
  for (const file of files) {
    if (!SRC_EXT.test(file)) continue
    if (scanned >= 1000) break
    scanned++
    try {
      const content = await window.electronAPI.fs.readFile(file)
      if (content.length > 400000) continue
      const lines = content.split('\n').slice(0, 1500)
      for (let i = 0; i < lines.length; i++) {
        const score = scoreLine(lines[i], symbol, kind, lines[i + 1])
        if (score > bestScore) {
          bestScore = score
          best = { file, line: i + 1 }
        }
      }
    } catch { /* unreadable */ }
  }
  return best
}

/**
 * Collects EVERY workspace file with an implementation of `symbol` (best line per file),
 * sorted by match confidence. Used to let the user pick when several classes implement
 * the same interface member.
 */
export async function searchImplementations(rootPath: string, symbol: string): Promise<WorkspaceHit[]> {
  if (!rootPath) return []
  let files: string[]
  try {
    files = await window.electronAPI.fs.listFiles(rootPath, 3000)
  } catch {
    return []
  }
  const scored: (WorkspaceHit & { score: number })[] = []
  let scanned = 0
  for (const file of files) {
    if (!SRC_EXT.test(file)) continue
    if (scanned >= 1000) break
    scanned++
    try {
      const content = await window.electronAPI.fs.readFile(file)
      if (content.length > 400000) continue
      const lines = content.split('\n').slice(0, 1500)
      let bestScore = 0
      let bestLine = 0
      for (let i = 0; i < lines.length; i++) {
        const score = scoreLine(lines[i], symbol, 'implementation', lines[i + 1])
        if (score > bestScore) {
          bestScore = score
          bestLine = i + 1
        }
      }
      if (bestLine) scored.push({ file, line: bestLine, score: bestScore })
    } catch { /* unreadable */ }
  }
  return scored.sort((a, b) => b.score - a.score).map(h => ({ file: h.file, line: h.line }))
}

/**
 * Searches workspace files (bounded) for every occurrence of `symbol`.
 */
export async function searchWorkspaceReferences(rootPath: string, symbol: string): Promise<WorkspaceHit[]> {
  if (!rootPath) return []
  let files: string[]
  try {
    files = await window.electronAPI.fs.listFiles(rootPath, 3000)
  } catch {
    return []
  }
  const hits: WorkspaceHit[] = []
  let scanned = 0
  for (const file of files) {
    if (!SRC_EXT.test(file)) continue
    if (scanned >= 1000) break
    scanned++
    try {
      const content = await window.electronAPI.fs.readFile(file)
      if (content.length > 400000) continue
      const lines = content.split('\n').slice(0, 1500)
      for (const line of findReferenceLines(lines, symbol, 0)) {
        hits.push({ file, line })
      }
    } catch { /* unreadable */ }
  }
  return hits
}
