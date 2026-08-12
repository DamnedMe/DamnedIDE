import type { SqlForeignKeyInfo } from '../../types/sql'

const IDENT_PART = '(?:\\[[^\\]]*(?:\\]\\][^\\]]*)*\\]|[A-Za-z_][A-Za-z0-9_$#@]*)'
const RESERVED_AFTER_TABLE = new Set([
  'where', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross',
  'group', 'order', 'having', 'union', 'except', 'intersect', 'offset',
  'fetch', 'for', 'option', 'with', 'on'
])

function unquoteIdentifier(value: string): string {
  const text = value.trim()
  return text.startsWith('[') && text.endsWith(']')
    ? text.slice(1, -1).replace(/]]/g, ']')
    : text
}

export function quoteSqlIdentifier(value: string): string {
  return `[${value.replace(/]/g, ']]')}]`
}

function splitQualifiedName(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let bracketed = false
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === '[') bracketed = true
    if (char === ']' && bracketed) {
      if (value[i + 1] === ']') {
        current += ']]'
        i++
        continue
      }
      bracketed = false
    }
    if (char === '.' && !bracketed) {
      if (current.trim()) parts.push(unquoteIdentifier(current))
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(unquoteIdentifier(current))
  return parts
}

function normalizeTable(value: string): { schema: string; table: string } | null {
  const parts = splitQualifiedName(value)
  if (parts.length === 0) return null
  return {
    schema: parts.length >= 2 ? parts[parts.length - 2] : 'dbo',
    table: parts[parts.length - 1]
  }
}

function sameTable(left: string, right: { schema: string; table: string }): boolean {
  const parsed = normalizeTable(left)
  return !!parsed && parsed.schema.toLowerCase() === right.schema.toLowerCase() && parsed.table.toLowerCase() === right.table.toLowerCase()
}

export interface SqlBaseTable {
  schema: string
  table: string
  alias?: string
}

export function buildExplicitSelect(
  table: string,
  columns: Array<string | { name: string }>,
  limit?: number
): string {
  const quote = (name: string) => name.split('.').map(part => `[${part.replace(/]/g, ']]')}]`).join('.')
  const qualifier = quote(table.split('.').pop() || table)
  const select = `SELECT${limit === undefined ? '' : ` TOP (${limit})`}`
  if (columns.length === 0) return `${select} *\nFROM ${quote(table)}`
  const fields = columns.map((column, index) => {
    const name = typeof column === 'string' ? column : column.name
    return `${index === 0 ? '       ' : '      ,'}${qualifier}.${quoteSqlIdentifier(name)}`
  }).join('\n')
  return `${select}\n${fields}\nFROM ${quote(table)}`
}

export function appendJoinedSelectColumns(
  query: string,
  alias: string,
  table: string,
  columns: Array<string | { name: string }>
): string {
  if (columns.length === 0) return query
  const from = /\bFROM\b/i.exec(query)
  if (!from) return query
  const tableLabel = splitQualifiedName(table).pop() || table
  const projections = columns.map(column => {
    const name = typeof column === 'string' ? column : column.name
    const outputName = `${tableLabel} · ${alias}.${name}`
    return `      ,${quoteSqlIdentifier(alias)}.${quoteSqlIdentifier(name)} AS ${quoteSqlIdentifier(outputName)}`
  }).join('\n')
  return `${query.slice(0, from.index).trimEnd()}\n${projections}\n${query.slice(from.index)}`
}

export function extractSqlBaseTable(query: string): SqlBaseTable | null {
  const re = new RegExp(
    `\\bFROM\\s+(${IDENT_PART})(?:\\s*\\.\\s*(${IDENT_PART}))?(?:\\s*\\.\\s*(${IDENT_PART}))?(?:\\s+(?:AS\\s+)?(${IDENT_PART}))?`,
    'i'
  )
  const match = re.exec(query)
  if (!match) return null
  const parts = [match[1], match[2], match[3]].filter(Boolean).map(unquoteIdentifier)
  const aliasCandidate = match[4] ? unquoteIdentifier(match[4]) : undefined
  const alias = aliasCandidate && !RESERVED_AFTER_TABLE.has(aliasCandidate.toLowerCase()) ? aliasCandidate : undefined
  return {
    schema: parts.length >= 2 ? parts[parts.length - 2] : 'dbo',
    table: parts[parts.length - 1],
    alias
  }
}

function compactSql(value: string): string {
  return value
    .replace(/\[([^\]]*(?:\]\][^\]]*)*)\]/g, (_match, identifier: string) => identifier.replace(/]]/g, ']'))
    .replace(/\s+/g, '')
    .toLowerCase()
}

function queryContainsRelationship(
  query: string,
  target: { schema: string; table: string },
  targetColumn: string,
  baseQualifier: string,
  baseColumn: string
): boolean {
  const re = new RegExp(
    `\\b(?:LEFT|RIGHT|INNER|FULL|CROSS|OUTER)?\\s*JOIN\\s+(${IDENT_PART})(?:\\s*\\.\\s*(${IDENT_PART}))?(?:\\s*\\.\\s*(${IDENT_PART}))?(?:\\s+(?:AS\\s+)?(${IDENT_PART}))?\\s+ON\\s+([\\s\\S]*?)(?=\\b(?:LEFT|RIGHT|INNER|FULL|CROSS|OUTER)?\\s*JOIN\\b|\\b(?:WHERE|GROUP\\s+BY|ORDER\\s+BY|HAVING|UNION|EXCEPT|INTERSECT|OFFSET|FOR\\s+JSON|FOR\\s+XML|OPTION)\\b|;|$)`,
    'gi'
  )
  let match: RegExpExecArray | null
  while ((match = re.exec(query))) {
    const parts = [match[1], match[2], match[3]].filter(Boolean).map(unquoteIdentifier)
    const schema = parts.length >= 2 ? parts[parts.length - 2] : 'dbo'
    const table = parts[parts.length - 1]
    if (schema.toLowerCase() !== target.schema.toLowerCase() || table.toLowerCase() !== target.table.toLowerCase()) continue

    const aliasCandidate = match[4] ? unquoteIdentifier(match[4]) : undefined
    const targetQualifier = aliasCandidate && !RESERVED_AFTER_TABLE.has(aliasCandidate.toLowerCase())
      ? aliasCandidate
      : table
    const onClause = compactSql(match[5])
    const forward = compactSql(`${targetQualifier}.${targetColumn}=${baseQualifier}.${baseColumn}`)
    const reverse = compactSql(`${baseQualifier}.${baseColumn}=${targetQualifier}.${targetColumn}`)
    if (onClause.includes(forward) || onClause.includes(reverse)) return true
  }
  return false
}

function nextAlias(query: string): string {
  let index = 1
  while (new RegExp(`\\bfk${index}\\b`, 'i').test(query)) index++
  return `fk${index}`
}

export type JoinAppendStatus = 'added' | 'no-base-table' | 'unrelated' | 'already-present' | 'invalid'

export function appendRelatedJoin(query: string, fk: SqlForeignKeyInfo): { query: string; status: JoinAppendStatus; alias?: string; targetTable?: string } {
  const base = extractSqlBaseTable(query)
  if (!base) return { query, status: 'no-base-table' }

  const outbound = sameTable(fk.table, base)
  const inbound = sameTable(fk.referencedTable, base)
  if (!outbound && !inbound) return { query, status: 'unrelated' }

  const targetName = outbound ? fk.referencedTable : fk.table
  const target = normalizeTable(targetName)
  if (!target || !fk.column || !fk.referencedColumn) return { query, status: 'invalid' }
  const targetColumn = outbound ? fk.referencedColumn : fk.column
  const baseColumn = outbound ? fk.column : fk.referencedColumn
  const baseQualifierName = base.alias || base.table
  if (queryContainsRelationship(query, target, targetColumn, baseQualifierName, baseColumn)) {
    return { query, status: 'already-present' }
  }

  const alias = nextAlias(query)
  const baseQualifier = quoteSqlIdentifier(baseQualifierName)
  const targetQualifier = quoteSqlIdentifier(alias)
  const targetSql = `${quoteSqlIdentifier(target.schema)}.${quoteSqlIdentifier(target.table)}`
  const join = `\nLEFT JOIN ${targetSql} AS ${targetQualifier} ON ${targetQualifier}.${quoteSqlIdentifier(targetColumn)} = ${baseQualifier}.${quoteSqlIdentifier(baseColumn)}`

  const clause = /\b(WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|UNION|EXCEPT|INTERSECT|OFFSET|FOR\s+JSON|FOR\s+XML|OPTION)\b/i.exec(query)
  if (clause) {
    return {
      query: query.slice(0, clause.index).trimEnd() + join + '\n' + query.slice(clause.index).trimStart(),
      status: 'added',
      alias,
      targetTable: targetName
    }
  }

  let body = query.trimEnd()
  const semicolon = body.endsWith(';')
  if (semicolon) body = body.slice(0, -1).trimEnd()
  return { query: body + join + (semicolon ? ';\n' : '\n'), status: 'added', alias, targetTable: targetName }
}

export function getSqlResultTableName(query: string): string | undefined {
  const base = extractSqlBaseTable(query)
  return base ? `${base.schema}.${base.table}` : undefined
}
