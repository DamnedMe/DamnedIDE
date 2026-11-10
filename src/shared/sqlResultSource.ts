// Where a grid edit must write. A batch can return several result sets and a
// result set can join several tables, so the editable table and key are resolved
// per result set and per column, never from the editor text:
// 1. mapResultSets() ties each result set to the statement that produced it;
// 2. the main process asks SQL Server to describe that statement
//    (sp_describe_first_result_set, browse mode: source table/column of every
//    output column, plus the key columns it needs to identify the row);
// 3. buildResultSource() turns that description into SqlResultSource, and the
//    grid resolves a column with resolveColumnEdit() before building the UPDATE.
// Anything uncertain refuses the edit with a reason instead of guessing.
// React-free: imported by the main process, the grid and scripts/sql-result-source.check.ts.

/** The grid's refusal reasons are English; the grid passes its `t`/`tr` (i18n) to translate them.
 *  The `blocked` texts built for the main process (mapResultSets, buildResultSource) stay Italian. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string
const en: Translate = (key, vars) => (vars ? key.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : key)

export interface SqlColumnSource {
  /** output column name, as the grid shows it */
  name: string
  /** key column SQL Server added because the select list does not include it */
  hidden: boolean
  /** schema.table the column reads from (db.schema.table when another database); absent for expressions */
  table?: string
  /** column name in that table (differs from name when aliased) */
  column?: string
  /** part of the key SQL Server uses to identify the source row */
  key: boolean
}

export interface SqlResultSource {
  /** schema.table of the statement's FROM: insert, delete and export target */
  table?: string
  /** one entry per described column, in order, hidden key columns included */
  columns?: SqlColumnSource[]
  /** why the result set cannot be edited at all (Italian, shown to the user) */
  blocked?: string
}

// ─── Batch → statements ─────────────────────────────────────────────────────

type StatementKind = 'rows' | 'none' | 'write' | 'unknown'

export interface SqlStatement {
  text: string
  /** rows = returns one result set; none/write = returns none; unknown = cannot tell (EXEC, IF, OUTPUT…) */
  kind: StatementKind
  /** database in effect (last USE before it) */
  database?: string
}

interface Token {
  word: boolean
  /** upper-cased word, unquoted identifier, or the punctuation itself */
  value: string
  start: number
  end: number
  depth: number
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  let depth = 0
  let i = 0
  const push = (word: boolean, value: string, start: number, end: number) => tokens.push({ word, value, start, end, depth })
  while (i < sql.length) {
    const c = sql[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      // T-SQL block comments nest
      let nest = 0
      while (i < sql.length) {
        if (sql[i] === '/' && sql[i + 1] === '*') { nest++; i += 2 }
        else if (sql[i] === '*' && sql[i + 1] === '/') { nest--; i += 2; if (nest === 0) break }
        else i++
      }
      continue
    }
    // strings and quoted identifiers ([x], "x") are single non-keyword tokens;
    // a doubled closing char is an escaped one
    const quoted = (skip: number, close: string, value: string) => {
      let j = i + skip
      while (j < sql.length) {
        if (sql[j] === close) {
          if (sql[j + 1] === close) { j += 2; continue }
          j++
          break
        }
        j++
      }
      push(false, value, i, j)
      i = j
    }
    if (c === '\'') { quoted(1, '\'', '\''); continue }
    if ((c === 'N' || c === 'n') && sql[i + 1] === '\'') { quoted(2, '\'', '\''); continue }
    if (c === '[') { quoted(1, ']', 'IDENT'); continue }
    if (c === '"') { quoted(1, '"', 'IDENT'); continue }
    const word = /^[\p{L}_@#][\p{L}\p{N}_@#$]*/u.exec(sql.slice(i, i + 256))
    if (word) {
      push(true, word[0].toUpperCase(), i, i + word[0].length)
      i += word[0].length
      continue
    }
    if (c === '(') { push(false, c, i, i + 1); depth++; i++; continue }
    if (c === ')') { depth = Math.max(0, depth - 1); push(false, c, i, i + 1); i++; continue }
    push(false, c, i, i + 1)
    i++
  }
  return tokens
}

const STARTERS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'WITH', 'USE', 'SET', 'DECLARE', 'PRINT',
  'EXEC', 'EXECUTE', 'IF', 'WHILE', 'BEGIN', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RAISERROR',
  'RETURN', 'GOTO', 'BREAK', 'CONTINUE', 'WAITFOR', 'GRANT', 'REVOKE', 'DENY', 'BACKUP', 'RESTORE',
  // no FETCH: `OFFSET … FETCH NEXT` belongs to the SELECT; a glued cursor FETCH only blocks the mapping
  'DBCC', 'COMMIT', 'ROLLBACK', 'SAVE', 'OPEN', 'CLOSE', 'DEALLOCATE', 'KILL', 'BULK'
])
const DML = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'])
// a SELECT/EXEC right after these words continues the same statement
const CONTINUE_AFTER = new Set(['UNION', 'ALL', 'EXCEPT', 'INTERSECT', 'FOR'])

const depth0Words = (statement: Token[]) => statement.filter(t => t.word && t.depth === 0).map(t => t.value)

/** the DML verb of a statement: its head, or the first DML word after a CTE */
function verbOf(statement: Token[]): string | undefined {
  const head = statement[0]?.value
  if (head !== 'WITH') return head
  return depth0Words(statement).slice(1).find(word => DML.has(word))
}

function looksLikeCte(tokens: Token[], i: number): boolean {
  const name = tokens[i + 1]
  const after = tokens[i + 2]
  // `WITH (NOLOCK)`, `WITH TIES`, `WITH CHECK OPTION`… are clauses, not a CTE
  return !!name && (name.word || name.value === 'IDENT') && !!after && (after.value === 'AS' || after.value === '(')
}

function startsStatement(current: Token[], tokens: Token[], i: number): boolean {
  const word = tokens[i].value
  if (!STARTERS.has(word)) return false
  const previous = current[current.length - 1]
  if (previous.word && CONTINUE_AFTER.has(previous.value)) return false
  const head = current[0].value
  const verb = verbOf(current)
  if (verb === 'MERGE') return false // MERGE must end with ';' and contains UPDATE/INSERT/DELETE
  if (word === 'WITH' && !looksLikeCte(tokens, i)) return false
  if (head === 'WITH' && !verb && DML.has(word)) return false
  // the depth-0 words after the verb (after the head when there is no CTE)
  const words = depth0Words(current)
  const after = words.slice(head === 'WITH' ? words.indexOf(verb ?? '') + 1 : 1)
  if (verb === 'INSERT' && (word === 'SELECT' || word === 'EXEC' || word === 'EXECUTE')
    && !after.some(w => w === 'VALUES' || w === 'SELECT' || w === 'EXEC' || w === 'EXECUTE' || w === 'DEFAULT')) return false
  if (verb === 'UPDATE' && word === 'SET' && !after.includes('SET')) return false
  if (head === 'DROP' && word === 'IF') return false
  // GRANT SELECT, INSERT ON t TO u: permissions until TO/FROM
  if ((head === 'GRANT' || head === 'REVOKE' || head === 'DENY') && !after.includes('TO') && !after.includes('FROM')) return false
  return true
}

function isAssignmentSelect(sql: string, statement: Token[]): boolean {
  let i = statement.findIndex(t => t.word && t.depth === 0 && t.value === 'SELECT') + 1
  const at = (k: number) => statement[k]?.value
  while (at(i) === 'DISTINCT' || at(i) === 'ALL') i++
  if (at(i) === 'TOP') {
    i++
    if (at(i) === '(') { const close = statement.findIndex((t, k) => k > i && t.value === ')' && t.depth === statement[i].depth); i = close + 1 }
    else i++
    if (at(i) === 'PERCENT') i++
    if (at(i) === 'WITH' && at(i + 1) === 'TIES') i += 2
  }
  const target = statement[i]
  return !!target && target.word && target.value.startsWith('@') && !target.value.startsWith('@@')
    && /^\s*[-+*/%&^|]?=/.test(sql.slice(target.end, target.end + 8))
}

function classify(sql: string, statement: Token[]): StatementKind {
  const head = statement[0].value
  const second = statement[1]?.value ?? ''
  const words = depth0Words(statement)
  switch (verbOf(statement)) {
    case 'SELECT':
      if (words.includes('INTO')) return 'write'
      return isAssignmentSelect(sql, statement) ? 'none' : 'rows'
    case 'INSERT': case 'UPDATE': case 'DELETE': case 'MERGE':
      return words.includes('OUTPUT') ? 'unknown' : 'write'
  }
  switch (head) {
    case 'USE': case 'DECLARE': case 'PRINT': case 'RAISERROR': case 'COMMIT': case 'ROLLBACK': case 'SAVE':
      return 'none'
    case 'SET':
      // these options add result sets of their own
      return /^(STATISTICS|SHOWPLAN)/.test(second) ? 'unknown' : 'none'
    case 'BEGIN':
      return second === 'TRAN' || second === 'TRANSACTION' || second === 'DISTRIBUTED' ? 'none' : 'unknown'
    case 'CREATE': case 'ALTER':
      return ['VIEW', 'PROC', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'OR'].includes(second) ? 'unknown' : 'write'
    case 'DROP': case 'TRUNCATE': case 'GRANT': case 'REVOKE': case 'DENY':
      return 'write'
    default:
      return 'unknown'
  }
}

/**
 * Splits a T-SQL batch into statements (with or without ';'), up to and
 * including the first statement whose result sets cannot be predicted.
 * `complete` is false when it stopped there.
 */
export function splitSqlBatch(sql: string): { statements: SqlStatement[]; complete: boolean } {
  const tokens = tokenize(sql)
  const groups: Token[][] = []
  let current: Token[] = []
  const flush = () => { if (current.length > 0) groups.push(current); current = [] }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.depth === 0 && token.value === ';') { flush(); continue }
    if (token.depth === 0 && token.word && current.length > 0 && startsStatement(current, tokens, i)) flush()
    current.push(token)
  }
  flush()

  const statements: SqlStatement[] = []
  let database: string | undefined
  for (const group of groups) {
    const kind = classify(sql, group)
    if (group[0].value === 'USE' && group[1]) database = sql.slice(group[1].start, group[1].end).replace(/^\[|\]$/g, '').replace(/]]/g, ']').replace(/^"|"$/g, '')
    statements.push({ text: sql.slice(group[0].start, group[group.length - 1].end), kind, database })
    if (kind === 'unknown') return { statements, complete: false }
  }
  return { statements, complete: true }
}

/** true when re-running the batch cannot change data (only SELECT, USE, SET, DECLARE, PRINT…) */
export function isReadOnlyBatch(sql: string): boolean {
  const { statements, complete } = splitSqlBatch(sql)
  return complete && statements.length > 0 && statements.every(s => s.kind === 'rows' || s.kind === 'none')
}

export interface SqlResultStatement {
  /** the statement that produced the result set */
  statement: string
  /** what to describe: the DECLAREs before it (for its variables) plus the statement */
  describe: string
  database?: string
}

/** One entry per result set: its statement, or why it cannot be identified. */
export function mapResultSets(sql: string, count: number): Array<SqlResultStatement | { blocked: string }> {
  const { statements, complete } = splitSqlBatch(sql)
  const producing = statements.filter(s => s.kind === 'rows')
  if (complete && producing.length !== count) {
    return Array.from({ length: count }, () => ({ blocked: 'Modifica non disponibile: non è stato possibile collegare i result set alle istruzioni della query.' }))
  }
  return Array.from({ length: count }, (_, index) => {
    const statement = producing[index]
    if (!statement) {
      return { blocked: `Modifica non disponibile: il result set ${index + 1} viene da EXEC, IF, OUTPUT o da un blocco BEGIN…END, quindi non si sa quale istruzione l'ha prodotto.` }
    }
    const declares = statements.slice(0, statements.indexOf(statement)).filter(s => /^DECLARE\b/i.test(s.text))
    return {
      statement: statement.text,
      describe: [...declares.map(s => s.text), statement.text].join(';\n'),
      database: statement.database
    }
  })
}

// ─── SQL Server description → SqlResultSource ───────────────────────────────

/** a row of sp_describe_first_result_set (only the fields used here) */
export interface SqlDescribedColumn {
  name: string | null
  is_hidden: boolean | null
  source_database: string | null
  source_schema: string | null
  source_table: string | null
  source_column: string | null
  is_part_of_unique_key: boolean | null
}

const same = (a?: string, b?: string) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

export function buildResultSource(
  described: SqlDescribedColumn[],
  resultColumns: string[],
  context: { baseTable?: string; database?: string } = {}
): SqlResultSource {
  const columns: SqlColumnSource[] = described.map(row => {
    const table = row.source_table
      ? [row.source_database && context.database && !same(row.source_database, context.database) ? row.source_database : '', row.source_schema || 'dbo', row.source_table].filter(Boolean).join('.')
      : undefined
    return {
      name: row.name ?? '',
      hidden: !!row.is_hidden,
      ...(table ? { table, column: row.source_column ?? undefined } : {}),
      key: !!row.is_part_of_unique_key
    }
  })
  // the grid merges duplicated names (mssql puts their values in an array), so
  // compare the distinct visible names: a mismatch means a wrong statement
  const visible = [...new Set(columns.filter(c => !c.hidden).map(c => c.name))]
  if (visible.length !== resultColumns.length || visible.some((name, i) => name !== resultColumns[i])) {
    return { blocked: 'Modifica non disponibile: le colonne del result set non corrispondono all\'istruzione descritta da SQL Server.' }
  }
  const table = context.baseTable && columns.find(c => same(c.table, context.baseTable))?.table
  return { ...(table ? { table } : {}), columns }
}

// ─── Grid edit → target ─────────────────────────────────────────────────────

export interface SqlKeyRef {
  /** key column in the target table */
  column: string
  /** grid column holding its value */
  resultColumn: string
  /** index among the grid columns with the same name (mssql merges them into an array) */
  occurrence: number
}

export interface SqlEditTarget {
  table: string
  /** column to SET (empty for a row target) */
  column: string
  keys: SqlKeyRef[]
}

export type SqlEditResolution = { ok: true; target: SqlEditTarget } | { ok: false; reason: string }

function keysOf(columns: SqlColumnSource[], table: string, t: Translate): SqlEditResolution {
  const visible = columns.filter(c => !c.hidden)
  const keys = columns.filter(c => c.key && same(c.table, table))
  if (keys.length === 0) {
    return { ok: false, reason: t('Edit refused: table {table} has no primary or unique key, so the row to change cannot be identified.', { table }) }
  }
  if (new Set(keys.map(k => (k.column ?? '').toLowerCase())).size !== keys.length) {
    return { ok: false, reason: t('Edit refused: {table} appears more than once in the query, so it is unclear which of its rows to change.', { table }) }
  }
  const hidden = keys.filter(k => k.hidden)
  if (hidden.length > 0) {
    return { ok: false, reason: t('Edit refused: add the key of {table} ({keys}) to the SELECT to edit its columns.', { table, keys: keys.map(k => k.column).join(', ') }) }
  }
  return {
    ok: true,
    target: {
      table,
      column: '',
      keys: keys.map(k => ({
        column: k.column ?? k.name,
        resultColumn: k.name,
        occurrence: visible.filter(c => c.name === k.name).indexOf(k)
      }))
    }
  }
}

/** Which table, column and key an edit of `column` writes to — or why it must be refused. */
export function resolveColumnEdit(source: SqlResultSource | undefined, column: string, t: Translate = en): SqlEditResolution {
  if (!source?.columns) {
    return { ok: false, reason: source?.blocked || t('Edit not available: SQL Server did not describe the source of this result set.') }
  }
  const matches = source.columns.filter(c => !c.hidden && c.name === column)
  if (matches.length === 0) return { ok: false, reason: t('Edit not available: column «{column}» not found in the result set description.', { column }) }
  if (matches.length > 1) {
    // 'A and B and C': the same chain the Italian text always had ('A e B e C')
    const tables = [...new Set(matches.map(c => c.table || t('expression')))].reduce((a, b) => t('{a} and {b}', { a, b }))
    return { ok: false, reason: t('Edit refused: several columns are named «{column}» ({tables}). Use an alias (AS) to edit it.', { column, tables }) }
  }
  const match = matches[0]
  if (!match.table || !match.column) {
    return { ok: false, reason: t('Edit refused: «{column}» is a computed value, not a table column.', { column }) }
  }
  const keys = keysOf(source.columns, match.table, t)
  return keys.ok ? { ok: true, target: { ...keys.target, column: match.column } } : keys
}

/** The base table and key a row delete writes to. */
export function resolveRowTarget(source: SqlResultSource | undefined, t: Translate = en): SqlEditResolution {
  if (!source?.columns) {
    return { ok: false, reason: source?.blocked || t('Delete not available: SQL Server did not describe the source of this result set.') }
  }
  if (!source.table) return { ok: false, reason: t('Delete not available: the source table of the row is not known.') }
  return keysOf(source.columns, source.table, t)
}

/** A new row can be inserted only when every column is a plain column of the base table. */
export function canInsertInto(source: SqlResultSource | undefined): boolean {
  const visible = source?.columns?.filter(c => !c.hidden) ?? []
  return !!source?.table && visible.length > 0 && visible.every(c => same(c.table, source.table) && c.column === c.name)
}

export function keyValue(row: Record<string, unknown>, key: SqlKeyRef): unknown {
  const value = row[key.resultColumn]
  return Array.isArray(value) ? value[key.occurrence] : value
}

/** Literal for a value read back from SQL Server (key values: exact match). */
export function sqlValueLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  // mssql reads datetimes as UTC (useUTC), so the ISO text is the stored value
  if (value instanceof Date) return `'${value.toISOString().slice(0, 23)}'`
  if (value instanceof Uint8Array) return `0x${Array.from(value, b => b.toString(16).padStart(2, '0')).join('')}`
  return `N'${String(value).replace(/'/g, '\'\'')}'`
}

const quoteIdent = (name: string) => `[${name.replace(/]/g, ']]')}]`
const quoteName = (table: string) => table.split('.').map(quoteIdent).join('.')

function wherePredicates(target: SqlEditTarget, row: Record<string, unknown>): string {
  return target.keys.map(key => {
    const value = keyValue(row, key)
    return value === null || value === undefined ? `${quoteIdent(key.column)} IS NULL` : `${quoteIdent(key.column)} = ${sqlValueLiteral(value)}`
  }).join(' AND ')
}

export function buildCellUpdate(target: SqlEditTarget, row: Record<string, unknown>, setLiteral: string): string {
  return `UPDATE ${quoteName(target.table)}\nSET ${quoteIdent(target.column)} = ${setLiteral}\nWHERE ${wherePredicates(target, row)}`
}

export function buildRowDelete(target: SqlEditTarget, row: Record<string, unknown>): string {
  return `DELETE FROM ${quoteName(target.table)}\nWHERE ${wherePredicates(target, row)}`
}
