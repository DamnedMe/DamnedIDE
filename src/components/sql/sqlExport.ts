// Result-grid export writers (CSV, SQL INSERT, Excel cells, aligned text) and
// the clipboard text of a cell or a column. React-free: used by ResultViewer
// for one or many result sets, checked by scripts/sql-export.check.ts.

export interface ExportSet {
  /** heading of the set in multi-set exports, e.g. "Result set 2" */
  title: string
  /** schema.table the rows come from, when known */
  table?: string
  columns: string[]
  rows: Record<string, unknown>[]
  colTypes: Record<string, string>
}

export type XlsxCell = string | number | boolean | null

function gridDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0') + '00'
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${ms}`
}

/** A value as the grid shows it. */
export function formatCell(value: unknown, colType?: string): string {
  if (value === null || value === undefined) return 'NULL'
  if (colType === 'date') {
    const d = value instanceof Date ? value : new Date(String(value))
    if (!isNaN(d.getTime())) return gridDate(d)
  }
  return String(value)
}

/** one line of copied text: tabs and newlines would break the paste */
const flat = (text: string) => text.replace(/\t/g, ' ').replace(/\r?\n|\r/g, ' ')

/** The values of one column, one per line (copy column). */
export function columnText(rows: Record<string, unknown>[], column: string, colTypes: Record<string, string>): string {
  return rows.map(row => flat(formatCell(row[column], colTypes[column]))).join('\n')
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [columns.map(esc).join(',')]
  for (const row of rows) lines.push(columns.map((c) => esc(row[c])).join(','))
  return lines.join('\r\n')
}

function toSqlInserts(table: string, columns: string[], rows: Record<string, unknown>[], colTypes: Record<string, string>): string {
  const lit = (col: string, v: unknown): string => {
    if (v === null || v === undefined) return 'NULL'
    if (colTypes[col] === 'date' && v instanceof Date) {
      const p = (n: number) => String(n).padStart(2, '0')
      return `'${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}'`
    }
    if (colTypes[col] === 'number' || colTypes[col] === 'bigint' || colTypes[col] === 'boolean') return String(v)
    return `N'${String(v).replace(/'/g, "''")}'`
  }
  const names = columns.map(c => `[${c}]`).join(', ')
  const values = rows.map(r => `(${columns.map(c => lit(c, r[c])).join(', ')})`)
  const chunks: string[] = []
  for (let i = 0; i < values.length; i += 50) {
    chunks.push(`INSERT INTO ${table} (${names})\nVALUES\n${values.slice(i, i + 50).join(',\n')};`)
  }
  return chunks.join('\n\n')
}

/** INSERT script of a set: a header comment, then 50-row INSERT chunks. */
export function toSqlScript(set: ExportSet): string {
  const name = set.table ? set.table.split('.').map(p => `[${p}]`).join('.') : '[result]'
  const header = set.table
    ? `-- ${set.rows.length} row${set.rows.length === 1 ? '' : 's'} from ${name}`
    : '-- select a table (FROM clause) to get the real table name'
  return `${header}\n${toSqlInserts(name, set.columns, set.rows, set.colTypes)}`
}

/** Excel cells: numbers/booleans keep their type, dates as the grid shows them, nulls stay empty. */
export function xlsxRows(set: ExportSet): XlsxCell[][] {
  const cell = (col: string, value: unknown): XlsxCell => {
    if (value === null || value === undefined) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
    if (typeof value === 'boolean') return value
    if (typeof value === 'bigint') {
      return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : String(value)
    }
    if (value instanceof Date || set.colTypes[col] === 'date') return formatCell(value, 'date')
    return String(value)
  }
  return set.rows.map(row => set.columns.map(col => cell(col, row[col])))
}

// ponytail: widths count UTF-16 units, so wide glyphs (CJK, emoji) misalign; cells are cut for readability
const TEXT_CELL_MAX = 80

/**
 * Aligned text table, also a valid Markdown table (renders as a table where
 * chat/mail support it, stays aligned in a monospace editor). Numeric
 * columns are right-aligned.
 */
export function toTextTable(set: ExportSet): string {
  const clip = (text: string) => {
    const one = flat(text).replace(/\|/g, '\\|')
    return one.length > TEXT_CELL_MAX ? `${one.slice(0, TEXT_CELL_MAX - 1)}…` : one
  }
  const header = set.columns.map(clip)
  const body = set.rows.map(row => set.columns.map(col => clip(formatCell(row[col], set.colTypes[col]))))
  const numeric = set.columns.map(col => set.rows.length > 0 && set.rows.every(row => {
    const v = row[col]
    return v === null || v === undefined || typeof v === 'number' || typeof v === 'bigint'
  }))
  const widths = header.map(h => Math.max(3, h.length))
  for (const line of body) line.forEach((cell, i) => { if (cell.length > widths[i]) widths[i] = cell.length })
  const render = (cells: string[]) => `| ${cells.map((cell, i) => numeric[i] ? cell.padStart(widths[i]) : cell.padEnd(widths[i])).join(' | ')} |`
  const separator = `|${widths.map((w, i) => numeric[i] ? `${'-'.repeat(w + 1)}:` : '-'.repeat(w + 2)).join('|')}|`
  return [render(header), separator, ...body.map(render)].join('\n')
}

/** One block per set; several sets get a heading each. */
export function toTextTables(sets: ExportSet[]): string {
  if (sets.length === 1) return toTextTable(sets[0])
  return sets.map(set => {
    const heading = [set.title, set.table, `${set.rows.length} rig${set.rows.length === 1 ? 'a' : 'he'}`].filter(Boolean).join(' · ')
    return `${heading}\n${toTextTable(set)}`
  }).join('\n\n')
}
