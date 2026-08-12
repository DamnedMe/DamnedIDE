import type { SqlGridFilter, SqlGridQueryState } from '../../types/sql'
import { extractSqlBaseTable } from './sqlQueryUtils'
import { stripSqlCommentsAndStrings } from './sqlAssistant'

export interface SqlGridRewriteCapability {
  supported: boolean
  reason?: string
}

function quoteIdentifier(value: string): string {
  return `[${value.replace(/]/g, ']]')}]`
}

function sqlString(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`
}

function typedLiteral(value: string, dataType: string): string {
  if (/^(?:number|bigint|boolean|int|decimal|numeric|float|real|money|smallmoney|tinyint|smallint)$/i.test(dataType)) {
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) throw new Error('Enter a valid number')
    return value.trim()
  }
  if (/^(?:date|datetime|datetime2|smalldatetime|datetimeoffset|time)$/i.test(dataType)) return sqlString(value.trim())
  return sqlString(value)
}

export function canRewriteGridQuery(query: string): SqlGridRewriteCapability {
  const clean = stripSqlCommentsAndStrings(query).trim()
  if (/^WITH\b/i.test(clean)) return { supported: false, reason: 'CTE, set operations and grouped queries are read-only in the grid.' }
  if (!/^SELECT\b/i.test(clean)) return { supported: false, reason: 'Grid filters require a single SELECT statement.' }
  const withoutFinalSemi = clean.replace(/;\s*$/, '')
  if (withoutFinalSemi.includes(';')) return { supported: false, reason: 'Multiple SQL statements cannot be rewritten safely.' }
  if (/\b(?:UNION|EXCEPT|INTERSECT|GROUP\s+BY|HAVING)\b/i.test(clean)) return { supported: false, reason: 'CTE, set operations and grouped queries are read-only in the grid.' }
  if (/\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(clean)) return { supported: false, reason: 'Aggregated result columns cannot be filtered safely.' }
  if (!extractSqlBaseTable(query)) return { supported: false, reason: 'The base table could not be resolved.' }
  return { supported: true }
}

function filterPredicate(filter: SqlGridFilter, qualifier: string): string {
  const column = `${quoteIdentifier(qualifier)}.${quoteIdentifier(filter.column)}`
  if (filter.operator === 'isNull') return `${column} IS NULL`
  if (filter.operator === 'isNotNull') return `${column} IS NOT NULL`
  const value = typedLiteral(filter.value || '', filter.dataType)
  if (filter.operator === 'contains') return `${column} LIKE ${sqlString(`%${filter.value || ''}%`)}`
  if (filter.operator === 'startsWith') return `${column} LIKE ${sqlString(`${filter.value || ''}%`)}`
  if (filter.operator === 'between') return `${column} BETWEEN ${value} AND ${typedLiteral(filter.secondValue || '', filter.dataType)}`
  const operators = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const
  return `${column} ${operators[filter.operator]} ${value}`
}

function removeTrailingOrderBy(query: string): string {
  const clean = stripSqlCommentsAndStrings(query)
  const order = /\bORDER\s+BY\b/gi
  let match: RegExpExecArray | null
  let last: RegExpExecArray | null = null
  while ((match = order.exec(clean))) last = match
  if (!last) return query
  return query.slice(0, last.index).trimEnd()
}

export function buildGridQuery(state: SqlGridQueryState): string {
  const capability = canRewriteGridQuery(state.baseQuery)
  if (!capability.supported) throw new Error(capability.reason)
  const base = extractSqlBaseTable(state.baseQuery)!
  const qualifier = (base.alias || base.table).replace(/^\[|\]$/g, '')
  let query = removeTrailingOrderBy(state.baseQuery).trim().replace(/;\s*$/, '')
  if (state.filters.length > 0) {
    const predicates = state.filters.map(filter => filterPredicate(filter, qualifier)).join('\n  AND ')
    const clause = /\b(ORDER\s+BY|OFFSET|OPTION|FOR\s+(?:JSON|XML))\b/i.exec(stripSqlCommentsAndStrings(query))
    const insertion = clause?.index ?? query.length
    const before = query.slice(0, insertion).trimEnd()
    const after = query.slice(insertion).trimStart()
    query = /\bWHERE\b/i.test(stripSqlCommentsAndStrings(before))
      ? `${before}\n  AND ${predicates}${after ? `\n${after}` : ''}`
      : `${before}\nWHERE ${predicates}${after ? `\n${after}` : ''}`
  }
  if (state.sorts.length > 0) {
    query += `\nORDER BY ${state.sorts.map(sort => `${quoteIdentifier(qualifier)}.${quoteIdentifier(sort.column)} ${sort.direction.toUpperCase()}`).join(', ')}`
  }
  return `${query};`
}
