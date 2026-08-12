import type * as Monaco from 'monaco-editor'
import type { SqlForeignKeyEdge, SqlRoutineInfo, SqlSchemaObject, SqlSchemaSnapshot } from '../../types/sql'

export interface SqlAssistantContext {
  connectionId: string | null
  database?: string
}

export interface SqlAssistantProvider {
  getSnapshot(context: SqlAssistantContext): Promise<SqlSchemaSnapshot | null>
  invalidate(connectionId: string, database?: string): void
}

const snapshotCache = new Map<string, SqlSchemaSnapshot>()
const snapshotRequests = new Map<string, Promise<SqlSchemaSnapshot>>()

function snapshotKey(connectionId: string, database: string): string {
  return `${connectionId}:${database}`
}

export class LocalSqlAssistantProvider implements SqlAssistantProvider {
  async getSnapshot(context: SqlAssistantContext): Promise<SqlSchemaSnapshot | null> {
    if (!context.connectionId || !context.database) return null
    const key = snapshotKey(context.connectionId, context.database)
    const cached = snapshotCache.get(key)
    if (cached) return cached
    let request = snapshotRequests.get(key)
    if (!request) {
      request = window.electronAPI.sql.schemaSnapshot(context.connectionId, context.database)
      snapshotRequests.set(key, request)
    }
    try {
      const snapshot = await request
      snapshotCache.set(key, snapshot)
      return snapshot
    } finally {
      snapshotRequests.delete(key)
    }
  }

  invalidate(connectionId: string, database?: string): void {
    const prefix = database ? snapshotKey(connectionId, database) : `${connectionId}:`
    for (const key of snapshotCache.keys()) if (key.startsWith(prefix)) snapshotCache.delete(key)
    for (const key of snapshotRequests.keys()) if (key.startsWith(prefix)) snapshotRequests.delete(key)
  }
}

export const localSqlAssistant = new LocalSqlAssistantProvider()

export function stripSqlCommentsAndStrings(sql: string): string {
  let output = ''
  let index = 0
  while (index < sql.length) {
    if (sql[index] === "'") {
      output += ' '
      index++
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") { output += '  '; index += 2; continue }
        const char = sql[index++]
        output += char === '\n' ? '\n' : ' '
        if (char === "'") break
      }
      continue
    }
    if (sql[index] === '-' && sql[index + 1] === '-') {
      output += '  '
      index += 2
      while (index < sql.length && sql[index] !== '\n') { output += ' '; index++ }
      continue
    }
    if (sql[index] === '/' && sql[index + 1] === '*') {
      output += '  '
      index += 2
      while (index < sql.length) {
        if (sql[index] === '*' && sql[index + 1] === '/') { output += '  '; index += 2; break }
        output += sql[index] === '\n' ? '\n' : ' '
        index++
      }
      continue
    }
    output += sql[index++]
  }
  return output
}

function unquoteIdentifier(value: string): string {
  return value.trim().replace(/^\[|\]$/g, '').replace(/^"|"$/g, '')
}

export function extractSqlAliases(sql: string): Map<string, string> {
  const aliases = new Map<string, string>()
  const clean = stripSqlCommentsAndStrings(sql)
  const identifier = String.raw`(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$#@]*)`
  const pattern = new RegExp(String.raw`\b(?:FROM|JOIN)\s+(${identifier})(?:\s*\.\s*(${identifier}))?\s*(?:AS\s+)?(${identifier})?`, 'gi')
  for (const match of clean.matchAll(pattern)) {
    const first = unquoteIdentifier(match[1])
    const second = match[2] ? unquoteIdentifier(match[2]) : ''
    const table = second ? `${first}.${second}` : first
    const candidate = match[3] ? unquoteIdentifier(match[3]) : (second || first)
    if (/^(?:WHERE|LEFT|RIGHT|INNER|FULL|CROSS|JOIN|ON|GROUP|ORDER|HAVING|UNION)$/i.test(candidate)) {
      aliases.set(second || first, table)
    } else {
      aliases.set(candidate, table)
    }
  }
  return aliases
}

export type SqlCompletionClause = 'select' | 'from' | 'join' | 'on' | 'where' | 'group' | 'having' | 'order' | 'exec' | 'statement'

export interface SqlCompletionContext {
  statement: string
  beforeCursor: string
  clause: SqlCompletionClause
  aliases: Map<string, string>
}

function statementAtCursor(sql: string, cursorOffset: number): { statement: string; beforeCursor: string } {
  const clean = stripSqlCommentsAndStrings(sql)
  const boundaries = [0]
  const boundaryPattern = /;|^\s*GO\s*$/gim
  for (const match of clean.matchAll(boundaryPattern)) boundaries.push((match.index ?? 0) + match[0].length)
  const start = boundaries.filter(value => value <= cursorOffset).at(-1) ?? 0
  const nextBoundary = boundaries.find(value => value > cursorOffset)
  const end = nextBoundary === undefined ? clean.length : nextBoundary
  return { statement: clean.slice(start, end), beforeCursor: clean.slice(start, cursorOffset) }
}

export function analyzeSqlCompletionContext(sql: string, cursorOffset: number): SqlCompletionContext {
  const { statement, beforeCursor } = statementAtCursor(sql, cursorOffset)
  const clauses: Array<{ clause: SqlCompletionClause; pattern: RegExp }> = [
    { clause: 'select', pattern: /\bSELECT\b/gi },
    { clause: 'from', pattern: /\bFROM\b/gi },
    { clause: 'join', pattern: /\b(?:LEFT|RIGHT|FULL|INNER|CROSS|OUTER)?\s*JOIN\b/gi },
    { clause: 'on', pattern: /\bON\b/gi },
    { clause: 'where', pattern: /\bWHERE\b/gi },
    { clause: 'group', pattern: /\bGROUP\s+BY\b/gi },
    { clause: 'having', pattern: /\bHAVING\b/gi },
    { clause: 'order', pattern: /\bORDER\s+BY\b/gi },
    { clause: 'exec', pattern: /\bEXEC(?:UTE)?\b/gi }
  ]
  let clause: SqlCompletionClause = 'statement'
  let latest = -1
  for (const candidate of clauses) {
    for (const match of beforeCursor.matchAll(candidate.pattern)) {
      if ((match.index ?? -1) > latest) {
        latest = match.index ?? -1
        clause = candidate.clause
      }
    }
  }
  return { statement, beforeCursor, clause, aliases: extractSqlAliases(statement) }
}

function findObject(snapshot: SqlSchemaSnapshot, name: string): SqlSchemaObject | undefined {
  const normalized = name.toLocaleLowerCase()
  return snapshot.objects.find(object =>
    object.name.toLocaleLowerCase() === normalized || object.name.split('.').pop()?.toLocaleLowerCase() === normalized)
}

function quoteName(name: string): string {
  return name.split('.').map(part => `[${part.replace(/]/g, ']]')}]`).join('.')
}

function joinSnippet(edge: SqlForeignKeyEdge, baseTable: string, baseAlias: string, usedAliases: Set<string>): string | null {
  const baseLower = baseTable.toLocaleLowerCase()
  const outbound = edge.table.toLocaleLowerCase() === baseLower
  const inbound = edge.referencedTable.toLocaleLowerCase() === baseLower
  if (!outbound && !inbound) return null
  const target = outbound ? edge.referencedTable : edge.table
  const sourceColumn = outbound ? edge.column : edge.referencedColumn
  const targetColumn = outbound ? edge.referencedColumn : edge.column
  const semanticColumn = outbound ? edge.column : edge.referencedColumn
  const semanticAlias = semanticColumn.replace(/Id$/i, '')
  const defaultAlias = semanticAlias && semanticAlias.toLocaleLowerCase() !== baseAlias.toLocaleLowerCase()
    ? semanticAlias
    : (target.split('.').pop() || 'related')
  let alias = defaultAlias
  let suffix = 2
  while (usedAliases.has(alias.toLocaleLowerCase())) alias = `${defaultAlias}${suffix++}`
  return `LEFT JOIN ${quoteName(target)} AS [${alias}] ON [${alias}].[${targetColumn}] = [${baseAlias}].[${sourceColumn}]`
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'GROUP BY', 'ORDER BY', 'HAVING',
  'INSERT INTO', 'UPDATE', 'DELETE FROM', 'EXEC', 'DECLARE', 'BEGIN TRANSACTION', 'COMMIT', 'ROLLBACK',
  'WITH', 'AS', 'ON', 'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'
]

const CLAUSE_KEYWORDS: Record<SqlCompletionClause, string[]> = {
  statement: SQL_KEYWORDS,
  select: ['DISTINCT', 'TOP', 'AS', 'CASE', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'FROM'],
  from: ['AS', 'INNER JOIN', 'LEFT JOIN', 'WHERE', 'GROUP BY', 'ORDER BY'],
  join: ['ON', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN'],
  on: ['AND', 'OR', 'IS NULL', 'IS NOT NULL', 'WHERE', 'INNER JOIN', 'LEFT JOIN'],
  where: ['AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'EXISTS', 'IS NULL', 'IS NOT NULL', 'GROUP BY', 'ORDER BY'],
  group: ['HAVING', 'ORDER BY'],
  having: ['AND', 'OR', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ORDER BY'],
  order: ['ASC', 'DESC', 'OFFSET', 'FETCH NEXT'],
  exec: ['EXEC', 'OUTPUT']
}

const SQL_SNIPPETS: Array<{ label: string; detail: string; insertText: string }> = [
  { label: 'cte', detail: 'Common table expression', insertText: 'WITH ${1:cte_name} AS (\n\tSELECT ${2:*}\n\tFROM ${3:schema.table}\n)\nSELECT *\nFROM ${1:cte_name};' },
  { label: 'trycatch', detail: 'T-SQL TRY/CATCH', insertText: "BEGIN TRY\n\t${1:-- statement}\nEND TRY\nBEGIN CATCH\n\tTHROW;\nEND CATCH;" },
  { label: 'transaction', detail: 'Safe transaction block', insertText: "BEGIN TRANSACTION;\nBEGIN TRY\n\t${1:-- statement}\n\tCOMMIT;\nEND TRY\nBEGIN CATCH\n\tIF @@TRANCOUNT > 0 ROLLBACK;\n\tTHROW;\nEND CATCH;" },
  { label: 'groupby', detail: 'Grouped SELECT', insertText: 'SELECT ${1:column}, COUNT(*) AS [Count]\nFROM ${2:schema.table}\nGROUP BY ${1:column}\nORDER BY [Count] DESC;' },
  { label: 'exec', detail: 'Execute stored procedure', insertText: 'EXEC ${1:schema.procedure} ${2:@parameter = value};' }
]

function routineInsertText(routine: SqlRoutineInfo): string {
  if (routine.kind === 'procedure') {
    const parameters = routine.parameters.map((parameter, index) =>
      `${parameter.name} = ` + '${' + `${index + 1}:${parameter.type}` + '}' + (parameter.output ? ' OUTPUT' : '')).join(', ')
    return `EXEC ${quoteName(routine.name)}${parameters ? ` ${parameters}` : ''}`
  }
  const parameters = routine.parameters.map((parameter, index) => '${' + `${index + 1}:${parameter.type}` + '}').join(', ')
  return `${quoteName(routine.name)}(${parameters})`
}

export function registerSqlAssistant(
  monaco: typeof Monaco,
  getContext: () => SqlAssistantContext,
  provider: SqlAssistantProvider = localSqlAssistant
): Monaco.IDisposable {
  const completion = monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' '],
    provideCompletionItems: async (model, position) => {
      const snapshot = await provider.getSnapshot(getContext()).catch(() => null)
      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
      const fullSql = model.getValue()
      const analysis = analyzeSqlCompletionContext(fullSql, model.getOffsetAt(position))
      const aliasMatch = /(?:\[([^\]]+)\]|([A-Za-z_][\w$#@]*))\.\s*[A-Za-z_\w$#@]*$/i.exec(analysis.beforeCursor)
      const aliases = analysis.aliases
      const suggestions: Monaco.languages.CompletionItem[] = []

      if (snapshot && aliasMatch) {
        const alias = aliasMatch[1] || aliasMatch[2]
        const aliasedTable = [...aliases].find(([candidate]) => candidate.toLocaleLowerCase() === alias.toLocaleLowerCase())?.[1]
        const object = findObject(snapshot, aliasedTable || alias)
        if (object) {
          for (const column of object.columns) {
            suggestions.push({
              label: column.name,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `${object.name} · ${column.type}${column.nullable ? ' · nullable' : ' · required'}`,
              insertText: `[${column.name}]`,
              sortText: `0_${column.name.toLocaleLowerCase()}`,
              range
            })
          }
          return { suggestions }
        }
        const schemaObjects = snapshot.objects.filter(candidate => candidate.schema.toLocaleLowerCase() === alias.toLocaleLowerCase())
        if (schemaObjects.length > 0) {
          for (const candidate of schemaObjects) suggestions.push({
            label: candidate.name.split('.').pop() || candidate.name,
            detail: `${candidate.kind} · ${candidate.columns.length} columns`,
            kind: candidate.kind === 'view' ? monaco.languages.CompletionItemKind.Interface : monaco.languages.CompletionItemKind.Class,
            insertText: `[${(candidate.name.split('.').pop() || candidate.name).replace(/]/g, ']]')}]`,
            sortText: `0_${candidate.name.toLocaleLowerCase()}`,
            range
          })
          return { suggestions }
        }
      }

      const columnClauses: SqlCompletionClause[] = ['select', 'on', 'where', 'group', 'having', 'order']
      if (snapshot && columnClauses.includes(analysis.clause) && aliases.size > 0) {
        const visible = [...aliases].flatMap(([alias, table]) => {
          const object = findObject(snapshot, table)
          return object ? object.columns.map(column => ({ alias, object, column })) : []
        })
        const occurrences = new Map<string, number>()
        for (const item of visible) {
          const key = item.column.name.toLocaleLowerCase()
          occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
        }
        for (const item of visible) {
          const qualified = `[${item.alias.replace(/]/g, ']]')}].[${item.column.name.replace(/]/g, ']]')}]`
          suggestions.push({
            label: `${item.alias}.${item.column.name}`,
            filterText: `${item.alias}.${item.column.name} ${item.column.name}`,
            detail: `${item.object.name} · ${item.column.type}${item.column.nullable ? ' · nullable' : ''}`,
            documentation: occurrences.get(item.column.name.toLocaleLowerCase())! > 1
              ? `Qualified because **${item.column.name}** exists in more than one visible object.`
              : `Column from **${item.object.name}**.`,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: qualified,
            sortText: `0_${item.alias.toLocaleLowerCase()}_${item.column.name.toLocaleLowerCase()}`,
            range
          })
          if (occurrences.get(item.column.name.toLocaleLowerCase()) === 1) suggestions.push({
            label: item.column.name,
            detail: `${item.alias} · ${item.column.type}`,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: `[${item.column.name.replace(/]/g, ']]')}]`,
            sortText: `1_${item.column.name.toLocaleLowerCase()}`,
            range
          })
        }
        for (const [alias, table] of aliases) suggestions.push({
          label: alias,
          detail: `alias for ${table}`,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: `[${alias.replace(/]/g, ']]')}]`,
          sortText: `0_${alias.toLocaleLowerCase()}`,
          range
        })
      }

      for (const keyword of CLAUSE_KEYWORDS[analysis.clause]) suggestions.push({
        label: keyword,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: keyword,
        sortText: `3_${keyword.toLocaleLowerCase()}`,
        range
      })

      if (analysis.clause === 'statement' || analysis.clause === 'select') {
        for (const snippet of SQL_SNIPPETS) suggestions.push({
          label: snippet.label,
          detail: snippet.detail,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snippet.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: `4_${snippet.label}`,
          range
        })
      }
      if (snapshot) {
        if (analysis.clause === 'from' || analysis.clause === 'join' || analysis.clause === 'statement') {
          for (const object of snapshot.objects) suggestions.push({
            label: object.name,
            detail: `${object.kind} · ${object.columns.length} columns`,
            kind: object.kind === 'view' ? monaco.languages.CompletionItemKind.Interface : monaco.languages.CompletionItemKind.Class,
            insertText: quoteName(object.name),
            sortText: `1_${object.name.toLocaleLowerCase()}`,
            range
          })
        }
        if (analysis.clause === 'exec' || analysis.clause === 'statement') {
          for (const routine of snapshot.routines) suggestions.push({
            label: routine.name,
            detail: `${routine.kind}(${routine.parameters.map(parameter => parameter.type).join(', ')})`,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: routineInsertText(routine),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText: `0_${routine.name.toLocaleLowerCase()}`,
            range
          })
        }
        if (analysis.clause === 'join' || analysis.clause === 'from' || analysis.clause === 'on') {
          const usedAliases = new Set([...aliases.keys()].map(alias => alias.toLocaleLowerCase()))
          const added = new Set<string>()
          for (const [baseAlias, baseTable] of aliases) {
            for (const edge of snapshot.foreignKeys) {
              const snippet = joinSnippet(edge, baseTable, baseAlias, usedAliases)
              const key = `${baseAlias}:${edge.constraintName}`.toLocaleLowerCase()
              if (!snippet || added.has(key)) continue
              added.add(key)
              suggestions.push({
                label: `join ${edge.constraintName}`,
                detail: `${baseAlias} · ${edge.table}.${edge.column} → ${edge.referencedTable}.${edge.referencedColumn}`,
                documentation: `Adds a LEFT JOIN derived from foreign key **${edge.constraintName}**.`,
                kind: monaco.languages.CompletionItemKind.Snippet,
                insertText: snippet,
                sortText: `0_${edge.constraintName.toLocaleLowerCase()}`,
                range
              })
            }
          }
        }
      }
      return { suggestions }
    }
  })

  const signature = monaco.languages.registerSignatureHelpProvider('sql', {
    signatureHelpTriggerCharacters: ['(', ',', ' '],
    provideSignatureHelp: async (model, position) => {
      const snapshot = await provider.getSnapshot(getContext()).catch(() => null)
      if (!snapshot) return null
      const before = stripSqlCommentsAndStrings(model.getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column)))
      const functionMatch = /((?:\[[^\]]+\]|[\w$#@]+)(?:\s*\.\s*(?:\[[^\]]+\]|[\w$#@]+))?)\s*\([^()]*$/i.exec(before)
      const execMatch = /\bEXEC(?:UTE)?\s+((?:\[[^\]]+\]|[\w$#@]+)(?:\s*\.\s*(?:\[[^\]]+\]|[\w$#@]+))?)(?:\s+[^;()]*)?$/i.exec(before)
      const match = execMatch ?? functionMatch
      if (!match) return null
      const called = match[1].replace(/[\[\]\s]/g, '').toLocaleLowerCase()
      const routine = snapshot.routines.find(item => item.name.toLocaleLowerCase() === called || item.name.split('.').pop()?.toLocaleLowerCase() === called)
      if (!routine) return null
      const args = match[0].split(',').length - 1
      return {
        value: {
          activeParameter: Math.min(args, Math.max(0, routine.parameters.length - 1)),
          activeSignature: 0,
          signatures: [{
            label: `${routine.name}(${routine.parameters.map(parameter => `${parameter.name} ${parameter.type}`).join(', ')})`,
            parameters: routine.parameters.map(parameter => ({ label: `${parameter.name} ${parameter.type}` }))
          }]
        },
        dispose() {}
      }
    }
  })

  return { dispose: () => { completion.dispose(); signature.dispose() } }
}
