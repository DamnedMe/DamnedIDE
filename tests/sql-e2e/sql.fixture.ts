import { test as base, expect, Page } from '@playwright/test'

export const MOCK_CONNECTION_ID = 'sql-e2e-connection'
export const MOCK_DATABASE = 'massive_mock_db'

async function installElectronMock(page: Page) {
  await page.addInitScript(({ connectionId, database }) => {
    const persistedWorkspace = localStorage.getItem('sql-e2e-workspace')
    localStorage.clear()
    if (persistedWorkspace) localStorage.setItem('sql-e2e-workspace', persistedWorkspace)
    localStorage.setItem('damnedide_sql_connections', JSON.stringify([{
      id: connectionId,
      server: 'mock-sql-server',
      database,
      user: 'playwright',
      authType: 'sql',
      isConnected: false,
      label: `mock-sql-server/${database}`
    }]))

    const emptyAsync = async () => undefined
    const sql = {
      connect: async (config: { connectionId?: string; server?: string; encrypt?: boolean; port?: number }) => {
        ;(window as unknown as { __sqlMock: { connectConfigs: unknown[] } }).__sqlMock.connectConfigs.push(config)
        return config.connectionId || connectionId
      },
      disconnect: emptyAsync,
      query: async (_connection: string, query: string, queryId = 'mock-query') => {
        await new Promise(resolve => setTimeout(resolve, 150))
        if (/\bsp_help\b/i.test(query)) {
          const results = [
            { columns: ['Name', 'Owner', 'Type'], rows: [{ Name: 'MassiveRows', Owner: 'dbo', Type: 'user table' }], rowCount: 1, colTypes: {}, primaryKeys: [], foreignKeys: [], foreignKeyInfo: [], baseTableColumns: [] },
            { columns: ['Column_name', 'Type', 'Nullable'], rows: [{ Column_name: 'Id', Type: 'int', Nullable: 'no' }, { Column_name: 'Code', Type: 'nvarchar', Nullable: 'yes' }], rowCount: 2, colTypes: {}, primaryKeys: [], foreignKeys: [], foreignKeyInfo: [], baseTableColumns: [] },
            { columns: ['Index_name', 'Index_description'], rows: [{ Index_name: 'PK_MassiveRows', Index_description: 'clustered, unique, primary key' }], rowCount: 1, colTypes: {}, primaryKeys: [], foreignKeys: [], foreignKeyInfo: [], baseTableColumns: [] }
          ]
          return { queryId, results, totalRowCount: 4, truncated: false, maxRows: 250000, elapsedMs: 8, canceled: false, rowsAffected: [] }
        }
        if (/MassiveRows/i.test(query)) {
          const baseColumns = ['Id', 'ParentId', 'Code', 'Region', 'City', 'Street', 'PostalCode', 'Amount', 'IsActive', 'CreatedAt', 'UpdatedAt', 'Notes']
          const joined = /JOIN\s+\[dbo\]\.\[Parent\]\s+AS\s+\[fk1\]/i.test(query)
          const columns = joined ? [...baseColumns, 'Parent · fk1.Id', 'Parent · fk1.Name'] : baseColumns
          const rows = new Array(250000)
          for (let index = 0; index < rows.length; index++) {
            rows[index] = {
              Id: index + 1,
              ParentId: (index % 5000) + 1,
              Code: `ROW-${String(index + 1).padStart(7, '0')}`,
              Region: `R${index % 20}`,
              City: `City ${index % 500}`,
              Street: `Street ${index % 10000}`,
              PostalCode: String(10000 + index % 89999),
              Amount: (index * 17.31) % 100000,
              IsActive: index % 3 !== 0,
              CreatedAt: new Date(2024, 0, 1 + index % 365).toISOString(),
              UpdatedAt: new Date(2025, 0, 1 + index % 365).toISOString(),
              Notes: index % 11 === 0 ? null : `deterministic mock row ${index + 1}`
            }
            if (joined) {
              rows[index]['Parent · fk1.Id'] = (index % 5000) + 1
              rows[index]['Parent · fk1.Name'] = `Parent ${(index % 5000) + 1}`
            }
          }
          return {
            queryId,
            results: [{
              columns,
              rows,
              rowCount: rows.length,
              colTypes: { Id: 'number', ParentId: 'number', Amount: 'number', IsActive: 'boolean', CreatedAt: 'date', UpdatedAt: 'date' },
              primaryKeys: ['Id'],
              foreignKeys: ['ParentId'],
              foreignKeyInfo: [{ column: 'ParentId', table: 'dbo.MassiveRows', referencedTable: 'dbo.Parent', referencedColumn: 'Id' }],
              baseTableColumns: baseColumns
            }],
            totalRowCount: rows.length,
            truncated: false,
            maxRows: 250000,
            elapsedMs: 42,
            canceled: false,
            rowsAffected: []
          }
        }
        if (/WideRows/i.test(query)) {
          const columns = Array.from({ length: 240 }, (_, index) => `WideColumn${String(index).padStart(3, '0')}`)
          const rows = new Array(5000)
          for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row: Record<string, number> = {}
            for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
              row[columns[columnIndex]] = rowIndex * columns.length + columnIndex
            }
            rows[rowIndex] = row
          }
          return {
            queryId,
            results: [{
              columns,
              rows,
              rowCount: rows.length,
              colTypes: Object.fromEntries(columns.map(column => [column, 'number'])),
              primaryKeys: ['WideColumn000'],
              foreignKeys: [],
              foreignKeyInfo: [],
              baseTableColumns: columns
            }],
            totalRowCount: rows.length,
            truncated: false,
            maxRows: 250000,
            elapsedMs: 36,
            canceled: false,
            rowsAffected: []
          }
        }
        if (/AuditLog/i.test(query)) {
          const columns = ['Id', 'CreatedById', 'UpdatedById', 'Message']
          const rows = [{ Id: 1, CreatedById: 10, UpdatedById: 20, Message: 'two foreign keys to Users' }]
          return {
            queryId,
            results: [{
              columns,
              rows,
              rowCount: rows.length,
              colTypes: { Id: 'number', CreatedById: 'number', UpdatedById: 'number', Message: 'string' },
              primaryKeys: ['Id'],
              foreignKeys: ['CreatedById', 'UpdatedById'],
              foreignKeyInfo: [
                { column: 'CreatedById', table: 'dbo.AuditLog', referencedTable: 'dbo.Users', referencedColumn: 'Id' },
                { column: 'UpdatedById', table: 'dbo.AuditLog', referencedTable: 'dbo.Users', referencedColumn: 'Id' }
              ],
              baseTableColumns: columns
            }],
            totalRowCount: rows.length,
            truncated: false,
            maxRows: 250000,
            elapsedMs: 3,
            canceled: false,
            rowsAffected: []
          }
        }
        return { queryId, results: [], totalRowCount: 0, truncated: false, maxRows: 250000, elapsedMs: 1, canceled: false, rowsAffected: [] }
      },
      cancelQuery: emptyAsync,
      testConnection: async () => ({ ok: true, version: 'Microsoft SQL Server mock' }),
      serverInfo: async () => ({ version: 'SQL Server mock', server: 'mock-sql-server', database }),
      databases: async () => [database],
      tables: async () => ['dbo.MassiveRows', 'dbo.WideRows', 'dbo.AuditLog', 'dbo.Parent', 'dbo.Child', 'dbo.Users'],
      views: async () => ['dbo.ActiveRows'],
      procedures: async () => ['dbo.RebuildIndex'],
      functions: async () => ['dbo.RowScore'],
      columns: async (_connection: string, _database: string, table: string) => {
        const names = /WideRows/i.test(table)
          ? Array.from({ length: 240 }, (_, index) => `WideColumn${String(index).padStart(3, '0')}`)
            : /AuditLog/i.test(table)
              ? ['Id', 'CreatedById', 'UpdatedById', 'Message']
            : /(?:^|\.)Users$/i.test(table)
              ? ['Id', 'DisplayName']
            : /(?:^|\.)Parent$/i.test(table)
              ? ['Id', 'Name']
            : ['Id', 'ParentId', 'Code', 'Region', 'City', 'Street', 'PostalCode', 'Amount', 'IsActive', 'CreatedAt', 'UpdatedAt', 'Notes']
        return names.map((name, index) => ({
          name, type: index < 2 ? 'int' : 'nvarchar(200)', maxLength: index < 2 ? null : 200,
          nullable: index > 1, isPrimaryKey: name === 'Id' || name === 'WideColumn000',
          isForeignKey: name === 'ParentId' || name === 'CreatedById' || name === 'UpdatedById', defaultValue: null
        }))
      },
      objectDefinition: async () => 'CREATE VIEW [dbo].[ActiveRows] AS SELECT 1 AS Id',
      schemaSnapshot: async () => {
        const makeColumns = (names: string[]) => names.map((name, index) => ({
          name, type: index < 2 ? 'int' : 'nvarchar(200)', maxLength: index < 2 ? null : 200,
          nullable: index > 1, isPrimaryKey: name === 'Id', isForeignKey: name.endsWith('Id') && name !== 'Id', defaultValue: null
        }))
        return {
          database,
          loadedAt: Date.now(),
          objects: [
            { name: 'dbo.MassiveRows', schema: 'dbo', kind: 'table', columns: makeColumns(['Id', 'ParentId', 'Code', 'Region', 'City', 'Street', 'PostalCode', 'Amount', 'IsActive', 'CreatedAt', 'UpdatedAt', 'Notes']) },
            { name: 'dbo.Parent', schema: 'dbo', kind: 'table', columns: makeColumns(['Id', 'Name']) },
            { name: 'dbo.AuditLog', schema: 'dbo', kind: 'table', columns: makeColumns(['Id', 'CreatedById', 'UpdatedById', 'Message']) },
            { name: 'dbo.Users', schema: 'dbo', kind: 'table', columns: makeColumns(['Id', 'DisplayName']) },
            { name: 'dbo.ActiveRows', schema: 'dbo', kind: 'view', columns: makeColumns(['Id']) }
          ],
          foreignKeys: [{ constraintName: 'FK_MassiveRows_Parent', table: 'dbo.MassiveRows', column: 'ParentId', referencedTable: 'dbo.Parent', referencedColumn: 'Id' }],
          routines: [{ name: 'dbo.RebuildIndex', schema: 'dbo', kind: 'procedure', parameters: [{ name: '@TableName', type: 'nvarchar(128)', output: false }] }]
        }
      },
      workspaceLoad: async () => {
        const raw = localStorage.getItem('sql-e2e-workspace')
        return raw ? JSON.parse(raw) : { version: 1, tabs: [], activeTabId: null, history: [], favorites: [] }
      },
      workspaceSave: async (workspace: unknown) => {
        localStorage.setItem('sql-e2e-workspace', JSON.stringify(workspace))
      },
      diagram: async () => {
        ;(window as unknown as { __sqlMock: { queries: string[]; completedQueries: string[]; diagramCalls: number } }).__sqlMock.diagramCalls++
        await new Promise(resolve => setTimeout(resolve, 120))
        const column = (name: string, isPrimaryKey = false, isForeignKey = false) => ({
          name, type: 'int', maxLength: null, nullable: false, isPrimaryKey, isForeignKey, defaultValue: null
        })
        const tables = Array.from({ length: 300 }, (_, tableIndex) => ({
          name: `dbo.DiagramTable${String(tableIndex).padStart(3, '0')}`,
          columns: [
            column('Id', true),
            column('ParentId', false, true),
            ...Array.from({ length: 14 }, (_, columnIndex) => column(`Column${String(columnIndex).padStart(2, '0')}`))
          ]
        }))
        const edges = Array.from({ length: 300 }, (_, index) => ({
          constraintName: `FK_Diagram_${index}`,
          table: tables[index].name,
          column: 'ParentId',
          referencedTable: tables[(index + 1) % tables.length].name,
          referencedColumn: 'Id'
        }))
        return { tables, edges }
      },
      buildConnectionString: async () => 'Server=mock-sql-server;Database=massive_mock_db',
      parseConnectionString: async () => ({ server: 'mock-sql-server', database })
    }

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        platform: 'win32',
        sql,
        app: { initialTarget: async () => null, onOpenPath: () => () => {} },
        updater: {
          install: async () => true,
          state: async () => ({ packaged: false, currentVersion: '0.0.0', status: 'idle' }),
          check: async () => ({ packaged: false, currentVersion: '0.0.0', status: 'idle' }),
          onState: () => () => {},
          onDownloaded: () => () => {}
        },
        fs: { watch: async () => {}, unwatch: async () => {}, onChanged: () => () => {} },
        window: { minimize() {}, maximize() {}, close() {}, openDetached: async () => true },
        dialog: {
          openFolder: async () => null,
          saveSqlQuery: async (defaultName: string, content: string) => {
            ;(window as unknown as { __sqlMock: { savedQueries: Array<{ defaultName: string; content: string }> } }).__sqlMock.savedQueries.push({ defaultName, content })
            return `C:\\mock\\${defaultName}`
          }
        },
        ado: { connect: async () => true },
        clipboard: { write(text: string) { navigator.clipboard.writeText(text).catch(() => {}) } }
      }
    })
    ;(window as unknown as { __sqlMock?: { queries: string[]; completedQueries: string[]; diagramCalls: number; connectConfigs: unknown[]; savedQueries: Array<{ defaultName: string; content: string }> } }).__sqlMock = {
      queries: [],
      completedQueries: [],
      diagramCalls: 0,
      connectConfigs: [],
      savedQueries: []
    }
    const originalQuery = sql.query
    sql.query = async (connection: string, query: string, queryId?: string) => {
      ;(window as unknown as { __sqlMock: { queries: string[] } }).__sqlMock.queries.push(query)
      const result = await originalQuery(connection, query, queryId)
      ;(window as unknown as { __sqlMock: { completedQueries: string[] } }).__sqlMock.completedQueries.push(query)
      return result
    }
  }, { connectionId: MOCK_CONNECTION_ID, database: MOCK_DATABASE })
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await installElectronMock(page)
    await page.goto('/#/panel/sql')
    await expect(page.getByText('SQL Server', { exact: true })).toBeVisible()
    await use(page)
  }
})

export async function openMockDatabase(page: Page) {
  await page.getByLabel('connection mock-sql-server/massive_mock_db', { exact: true }).click()
  await page.getByLabel('expand connection mock-sql-server/massive_mock_db').click()
  await page.getByLabel('database massive_mock_db').click()
}

export async function openMockTables(page: Page) {
  await openMockDatabase(page)
  await page.getByLabel('tables massive_mock_db').click()
}

export { expect }
