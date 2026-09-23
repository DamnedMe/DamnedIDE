// Pure conflict parsing/resolution for the merge tool (no editor/electron deps),
// so it can be exercised with plain node.

export type MergeSide = 'ours' | 'theirs' | 'both'

export interface ConflictBlock {
  index: number
  startLine: number // 1-based line of '<<<<<<<' in the conflicted file
  endLine: number // 1-based line of '>>>>>>>'
  ours: string[]
  theirs: string[]
  oursStart: number // 1-based line of the first ours line
  theirsStart: number
  contextBefore: string[]
  contextAfter: string[]
}

const MARKER_START = '<<<<<<<'
const MARKER_SEP = '======='
const MARKER_END = '>>>>>>>'
const CONTEXT_LINES = 3

const isMarker = (line: string): boolean =>
  line.startsWith(MARKER_START) || line.startsWith(MARKER_SEP) || line.startsWith(MARKER_END)

// Context must not spill into the neighbouring conflict's markers.
function contextBefore(lines: string[], start: number): string[] {
  const window = lines.slice(Math.max(0, start - CONTEXT_LINES), start)
  const lastMarker = window.map(isMarker).lastIndexOf(true)
  return lastMarker >= 0 ? window.slice(lastMarker + 1) : window
}

function contextAfter(lines: string[], end: number): string[] {
  const window = lines.slice(end, end + CONTEXT_LINES)
  const firstMarker = window.findIndex(isMarker)
  return firstMarker >= 0 ? window.slice(0, firstMarker) : window
}

export function parseConflicts(text: string): ConflictBlock[] {
  const lines = text.split('\n')
  const blocks: ConflictBlock[] = []
  let pendingStart = -1
  let pendingSep = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith(MARKER_START)) {
      pendingStart = i
      pendingSep = -1
    } else if (line.startsWith(MARKER_SEP) && pendingStart >= 0) {
      pendingSep = i
    } else if (line.startsWith(MARKER_END) && pendingStart >= 0 && pendingSep >= 0) {
      const ours = lines.slice(pendingStart + 1, pendingSep)
      blocks.push({
        index: blocks.length,
        startLine: pendingStart + 1,
        endLine: i + 1,
        ours,
        theirs: lines.slice(pendingSep + 1, i),
        oursStart: pendingStart + 2,
        theirsStart: pendingSep + 2,
        contextBefore: contextBefore(lines, pendingStart),
        contextAfter: contextAfter(lines, i + 1)
      })
      pendingStart = -1
      pendingSep = -1
    }
  }
  return blocks
}

export function chosenLines(block: ConflictBlock, choice: MergeSide): string[] {
  if (choice === 'ours') return block.ours
  if (choice === 'theirs') return block.theirs
  return [...block.ours, ...block.theirs]
}

/**
 * Rebuilds the file from the original conflicted text plus the per-hunk choices.
 * Hunks without a choice keep their conflict markers (nothing is lost).
 */
export function applyChoices(
  original: string,
  blocks: ConflictBlock[],
  choices: Record<number, MergeSide | undefined>
): string {
  const lines = original.split('\n')
  const out: string[] = []
  let cursor = 0
  for (const block of blocks) {
    out.push(...lines.slice(cursor, block.startLine - 1))
    const choice = choices[block.index]
    if (choice) out.push(...chosenLines(block, choice))
    else out.push(...lines.slice(block.startLine - 1, block.endLine))
    cursor = block.endLine
  }
  out.push(...lines.slice(cursor))
  return out.join('\n')
}

export function unresolvedCount(blocks: ConflictBlock[], choices: Record<number, MergeSide | undefined>): number {
  return blocks.filter(b => !choices[b.index]).length
}

// Language detection for the merge tool (same mapping as the diff/edit editors).
export function detectLangForMerge(path?: string | null): string {
  if (!path) return 'plaintext'
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    cs: 'csharp', csproj: 'xml', sln: 'plaintext', slnx: 'plaintext',
    json: 'json', xml: 'xml', html: 'html', css: 'css', scss: 'scss',
    sql: 'sql', md: 'markdown', yaml: 'yaml', yml: 'yaml',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    ps1: 'powershell', sh: 'shell', bat: 'bat',
    gitignore: 'plaintext', dockerfile: 'dockerfile'
  }
  return map[ext || ''] || 'plaintext'
}
