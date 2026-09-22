const DEF_KEYWORDS = /(class|struct|interface|enum|record|function|func|def|fn|async|public|private|protected|internal|static|readonly|abstract|sealed|virtual|override|export|import|type|namespace|package|module|let|const|var|using|impl|trait|pub|val|constructor|new|ref|out|this\.)/i

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

const SRC_EXTS = ['.cs', '.ts', '.tsx', '.js', '.jsx', '.java', '.go', '.rs', '.py', '.c', '.cpp', '.h', '.hpp', '.cshtml', '.razor', '.sql']

/**
 * One bounded workspace scan for `symbol`, run in the main process: it walks and reads
 * files concurrently and stops early. The renderer used to list the tree and then read
 * up to a thousand files one IPC round-trip at a time, which is what made F12 hang for
 * seconds whenever semantic navigation was unavailable.
 */
async function scanWorkspace(rootPath: string, symbol: string, maxHits: number): Promise<{ file: string; line: number; preview: string; next: string }[]> {
  if (!rootPath || symbol.length < 2) return []
  try {
    return await window.electronAPI.fs.searchFiles(rootPath, symbol, maxHits, SRC_EXTS)
  } catch {
    return []
  }
}

/**
 * Searches workspace files (bounded) for a definition/implementation of `symbol`.
 */
export async function searchWorkspaceFiles(rootPath: string, symbol: string, kind: 'definition' | 'implementation'): Promise<WorkspaceHit | null> {
  let best: WorkspaceHit | null = null
  let bestScore = 0
  for (const hit of await scanWorkspace(rootPath, symbol, 4000)) {
    const score = scoreLine(hit.preview, symbol, kind, hit.next)
    if (score > bestScore) {
      bestScore = score
      best = { file: hit.file, line: hit.line }
    }
  }
  return best
}

/**
 * Collects EVERY workspace file with an implementation of `symbol` (best line per file),
 * sorted by match confidence. Used to let the user pick when several classes implement
 * the same interface member.
 */
export async function searchImplementations(rootPath: string, symbol: string): Promise<WorkspaceHit[]> {
  const best = new Map<string, WorkspaceHit & { score: number }>()
  for (const hit of await scanWorkspace(rootPath, symbol, 4000)) {
    const score = scoreLine(hit.preview, symbol, 'implementation', hit.next)
    if (score <= 0) continue
    const current = best.get(hit.file)
    if (!current || score > current.score) best.set(hit.file, { file: hit.file, line: hit.line, score })
  }
  return [...best.values()].sort((a, b) => b.score - a.score).map(h => ({ file: h.file, line: h.line }))
}

/**
 * Searches workspace files (bounded) for occurrences of `symbol`. Capped and stops
 * early so common symbols do not produce huge/hanging result lists.
 */
export async function searchWorkspaceReferences(rootPath: string, symbol: string, maxHits = 500): Promise<WorkspaceHit[]> {
  const re = new RegExp(`\\b${escapeRegExp(symbol)}\\b`)
  const hits: WorkspaceHit[] = []
  // the scan matches substrings case-insensitively: re-apply the word-boundary and
  // comment rules `findReferenceLines` uses so both paths agree on what a reference is
  for (const hit of await scanWorkspace(rootPath, symbol, maxHits * 4)) {
    if (!re.test(hit.preview) || isCommentLine(hit.preview)) continue
    hits.push({ file: hit.file, line: hit.line })
    if (hits.length >= maxHits) break
  }
  return hits
}
