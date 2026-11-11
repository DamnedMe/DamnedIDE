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
      // no pool is shared with another window: the startup reconnect goes on to connect
      isConnected: async () => false,
      setQueryTimeout: emptyAsync,
      sqlPackageInfo: async () => ({ found: true, path: 'C:\\mock\\SqlPackage.exe', hint: 'dotnet tool install -g microsoft.sqlpackage' }),
      restore: async (_connection: string, options: { path: string; database: string; replace: boolean }) => {
        ;(window as unknown as { __sqlMock: { restores: unknown[] } }).__sqlMock.restores.push(options)
        return {
          ok: true,
          elapsedMs: 12,
          statement: `RESTORE DATABASE [${options.database}]\nFROM DISK = N'${options.path}'\nWITH MOVE N'${options.database}' TO N'C:\\mock\\${options.database}.mdf', RECOVERY`
        }
      },
      dataTier: async (_connection: string, database: string, action: string, file: string) => {
        ;(window as unknown as { __sqlMock: { dataTiers: unknown[] } }).__sqlMock.dataTiers.push({ database, action, file })
        return { ok: true, output: 'mock sqlpackage' }
      },
      onDataTierLog: () => () => {},
      query: async (_connection: string, query: string, queryId = 'mock-query') => {
        await new Promise(resolve => setTimeout(resolve, 150))
        // `source` mirrors the main process (src/shared/sqlResultSource.ts): each
        // result set carries the table, columns and key SQL Server described for
        // its own statement; result sets of an EXEC cannot be mapped.
        type SourceColumn = { name: string; hidden: boolean; table?: string; column?: string; key: boolean }
        const sourceColumn = (name: string, table?: string, column = name, key = false): SourceColumn =>
          ({ name, hidden: false, ...(table ? { table, column } : {}), key })
        const tableSource = (table: string, columns: string[], key: string) =>
          ({ table, columns: columns.map(name => sourceColumn(name, table, name, name === key)) })
        if (/\bsp_help\b/i.test(query)) {
          const blocked = (n: number) => ({ blocked: `Modifica non disponibile: il result set ${n} viene da EXEC, IF, OUTPUT o da un blocco BEGIN…END, quindi non si sa quale istruzione l'ha prodotto.` })
          const results = [
            { columns: ['Name', 'Owner', 'Type'], rows: [{ Name: 'MassiveRows', Owner: 'dbo', Type: 'user table' }], rowCount: 1, colTypes: {}, primaryKeys: [], foreignKeys: [], foreignKeyInfo: [], baseTableColumns: [], source: blocked(1) },
            { columns: ['Column_name', 'Type', 'Nullable'], rows: [{ Column_name: 'Id', Type: 'int', Nullable: 'no' }, { Column_name: 'Code', Type: 'nvarchar', Nullable: 'yes' }], rowCount: 2, colTypes: {}, primaryKeys: [], foreignKeys: [], foreignKeyInfo: [], baseTableColumns: [], source: blocked(2) },
            { columns: ['Index_name', 'Index_description'], rows: [{ Index_name: 'PK_MassiveRows', Index_description: 'clustered, unique, primary key' }], rowCount: 1, colTypes: {}, primaryKeys: [], foreignKeys: [], foreignKeyInfo: [], baseTableColumns: [], source: blocked(3) }
          ]
          return { queryId, results, totalRowCount: 4, truncated: false, maxRows: 250000, elapsedMs: 8, canceled: false, rowsAffected: [] }
        }
        // Shop schema: Orders(Id PK, CustomerId, Total), Customers(Id PK, Name, Code),
        // Notes(OrderId, Note) without a key. One result set per SELECT of the batch.
        const body = query.replace(/^USE \[[^\]]*\];\n/, '').trim()
        if (/\bdbo\.(Orders|Customers)\b/i.test(body) && !/^(UPDATE|DELETE|INSERT)\b/i.test(body)) {
          const set = (columns: string[], rows: Record<string, unknown>[], source: unknown) => ({
            columns, rows, rowCount: rows.length,
            colTypes: Object.fromEntries(columns.map(c => [c, typeof rows[0][c] === 'number' ? 'number' : 'string'])),
            primaryKeys: ['Id'], foreignKeys: [], foreignKeyInfo: [], baseTableColumns: columns, source
          })
          const orders = () => set(['Id', 'CustomerId', 'Total'],
            [{ Id: 10, CustomerId: 1, Total: 99.5 }, { Id: 11, CustomerId: 2, Total: 12 }],
            tableSource('dbo.Orders', ['Id', 'CustomerId', 'Total'], 'Id'))
          const customers = () => set(['Id', 'Name', 'Code'],
            [{ Id: 1, Name: 'Ada', Code: 'C1' }, { Id: 2, Name: 'Bob', Code: 'C2' }],
            tableSource('dbo.Customers', ['Id', 'Name', 'Code'], 'Id'))
          const results = []
          if (/JOIN\s+dbo\.Customers/i.test(body)) {
            // SELECT * over the join: both Id columns reach mssql, which merges
            // equal names into one key holding an array of their values
            results.push(set(['Id', 'CustomerId', 'Total', 'Name', 'Code', 'OrderId', 'Note'], [
              { Id: [10, 1], CustomerId: 1, Total: 99.5, Name: 'Ada', Code: 'C1', OrderId: 10, Note: 'fragile' },
              { Id: [11, 2], CustomerId: 2, Total: 12, Name: 'Bob', Code: 'C2', OrderId: 11, Note: null }
            ], {
              table: 'dbo.Orders',
              columns: [
                sourceColumn('Id', 'dbo.Orders', 'Id', true), sourceColumn('CustomerId', 'dbo.Orders'), sourceColumn('Total', 'dbo.Orders'),
                sourceColumn('Id', 'dbo.Customers', 'Id', true), sourceColumn('Name', 'dbo.Customers'), sourceColumn('Code', 'dbo.Customers'),
                sourceColumn('OrderId', 'dbo.Notes'), sourceColumn('Note', 'dbo.Notes')
              ]
            }))
          } else {
            for (const match of body.matchAll(/FROM dbo\.(Orders|Customers)\b/gi)) results.push(match[1].toLowerCase() === 'orders' ? orders() : customers())
          }
          return { queryId, results, totalRowCount: results.reduce((n, r) => n + r.rowCount, 0), truncated: false, maxRows: 250000, elapsedMs: 4, canceled: false, rowsAffected: [] }
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
              baseTableColumns: baseColumns,
              source: {
                table: 'dbo.MassiveRows',
                columns: [
                  ...tableSource('dbo.MassiveRows', baseColumns, 'Id').columns,
                  ...(joined ? [sourceColumn('Parent · fk1.Id', 'dbo.Parent', 'Id', true), sourceColumn('Parent · fk1.Name', 'dbo.Parent', 'Name')] : [])
                ]
              }
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
              baseTableColumns: columns,
              source: tableSource('dbo.WideRows', columns, 'WideColumn000')
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
              baseTableColumns: columns,
              source: tableSource('dbo.AuditLog', columns, 'Id')
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

    // Azure DevOps settings are kept by the main process (src/shared/adoSettings.ts):
    // here an in-memory copy, empty by default. A spec seeds it with seedAdo() and
    // reads the recorded calls with adoCalls(); PATs only ever show as hasToken flags.
    type AdoRef = { connectionId: string; repository: string }
    type AdoList = { ok: true; repos: string[] } | { ok: false; error: string }
    const adoMock = {
      settings: {
        connections: [] as Array<{ id: string; organization: string; project: string }>,
        folders: {} as Record<string, AdoRef>,
        release: {} as Record<string, unknown>,
        tokens: {} as Record<string, boolean>
      },
      catalog: {} as Record<string, AdoList>,
      /** repositories a newly saved connection reads */
      newRepos: ['Repo-A', 'Repo-B'],
      /** `${repo}:${source}->${target}` -> commits (ado.commitsBetween) */
      commits: {} as Record<string, Array<{ commitId: string; message: string; author: string }>>,
      /** same keys -> Azure DevOps error: a strict read rejects with it, a lenient one returns [] (as main) */
      commitErrors: {} as Record<string, string>,
      /** repo -> active pull requests (ado.pullRequests) */
      pullRequests: {} as Record<string, unknown[]>,
      workItems: [] as Array<{ id: number; title: string; type: string; state: string; assignedTo: string; url: string }>,
      /** id of the next PR ado.createPr creates */
      nextPrId: 501,
      /** release chains kept by main (src/shared/adoChain.ts ReleaseChain) */
      chains: [] as Array<{ id: string; connectionId: string; organization: string; project: string; autoComplete: boolean; createdAt: number; items: Array<Record<string, unknown> & { status: string }> }>,
      calls: [] as Array<{ name: string; args: unknown[] }>
    }
    ;(window as unknown as { __adoMock: typeof adoMock }).__adoMock = adoMock
    const adoClone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
    const adoCall = (name: string, ...args: unknown[]) => { adoMock.calls.push({ name, args: args.map(adoClone) }) }
    const adoListeners = new Set<() => void>()
    // like main's adoSettings:changed after every write
    const adoChanged = () => { setTimeout(() => adoListeners.forEach(l => l()), 0) }
    const adoSettings = {
      get: async () => adoClone(adoMock.settings),
      saveConnection: async (input: { id?: string; organization: string; project: string; token?: string }) => {
        adoCall('saveConnection', input)
        const s = adoMock.settings
        // main verifies with Azure DevOps before saving; 'bad' plays a refused PAT
        if (input.organization.toLowerCase() === 'bad') {
          throw new Error("Error invoking remote method 'adoSettings:saveConnection': Error: PAT non valido, scaduto o senza permesso Code (Read)")
        }
        const id = input.id ?? `c${s.connections.length + 1}`
        const connection = { id, organization: input.organization, project: input.project }
        const i = s.connections.findIndex(c => c.id === id)
        if (i >= 0) s.connections[i] = connection
        else s.connections.push(connection)
        if (input.token) s.tokens[id] = true
        adoMock.catalog[id] = { ok: true, repos: [...adoMock.newRepos] }
        adoChanged()
        return { connection, repos: [...adoMock.newRepos] }
      },
      test: async (id: string) => {
        adoCall('test', id)
        return adoClone(adoMock.catalog[id] ?? { ok: false, error: 'connessione non trovata' })
      },
      removeConnection: async (id: string) => {
        adoCall('removeConnection', id)
        const s = adoMock.settings
        s.connections = s.connections.filter(c => c.id !== id)
        delete s.tokens[id]
        for (const [k, ref] of Object.entries(s.folders)) if (ref.connectionId === id) delete s.folders[k]
        adoChanged()
      },
      setFolder: async (key: string, ref: AdoRef | null) => {
        adoCall('setFolder', key, ref)
        if (ref) adoMock.settings.folders[key] = ref
        else delete adoMock.settings.folders[key]
        adoChanged()
      },
      setRelease: async (key: string, config: unknown) => {
        adoCall('setRelease', key, config)
        if (config) adoMock.settings.release[key] = adoClone(config)
        else delete adoMock.settings.release[key]
        adoChanged()
      },
      catalog: async (force?: boolean) => {
        adoCall('catalog', force)
        return Object.fromEntries(adoMock.settings.connections.map(c => [c.id, adoClone(adoMock.catalog[c.id] ?? { ok: true, repos: [] })]))
      },
      importLegacy: async (legacy: unknown, promotion: unknown) => {
        adoCall('importLegacy', legacy, promotion)
        return false
      },
      onChanged: (cb: () => void) => {
        adoListeners.add(cb)
        return () => { adoListeners.delete(cb) }
      }
    }
    const ado = {
      // main resolves the connection's PAT; false when it has none
      use: async (id: string) => { adoCall('use', id); return !!adoMock.settings.tokens[id] },
      workItems: async (project: string) => { adoCall('workItems', project); return [] },
      workItem: async () => null,
      workItemsBatch: async (project: string, ids: number[]) => {
        adoCall('workItemsBatch', project, ids)
        return adoClone(adoMock.workItems.filter(w => ids.includes(w.id)))
      },
      pullRequests: async (project: string, repo: string) => { adoCall('pullRequests', project, repo); return adoClone(adoMock.pullRequests[repo] ?? []) },
      pullRequestDetail: async () => null,
      pullRequestFiles: async () => [],
      pullRequestThreads: async () => [],
      fileContent: async () => '',
      branches: async (project: string, repo: string) => { adoCall('branches', project, repo); return ['develop', 'qa', 'main'] },
      repositories: async () => [],
      commitsBetween: async (project: string, repo: string, source: string, target: string, strict?: boolean) => {
        adoCall('commitsBetween', project, repo, source, target)
        const key = `${repo}:${source}->${target}`
        if (adoMock.commitErrors[key]) {
          if (strict) throw new Error(`Error invoking remote method 'ado:commitsBetween': Error: ${adoMock.commitErrors[key]}`)
          return []
        }
        return adoClone(adoMock.commits[key] ?? [])
      },
      setVote: async () => false,
      completePr: async () => false,
      createPr: async (project: string, repo: string, opts: { title: string; autoComplete: boolean }) => {
        adoCall('createPr', project, repo, opts)
        const id = adoMock.nextPrId++
        return { id, title: opts.title, mode: opts.autoComplete ? 'autocomplete' : 'open', url: `https://dev.azure.com/mock/${project}/_git/${repo}/pullrequest/${id}` }
      }
    }

    // release chains: main keeps and polls them; here start/cancel/remove only change the list
    type ChainStart = { connectionId: string; autoComplete: boolean; items: Array<{ side: string; repo: string; branches: unknown; qaPr?: { id: number; url: string } | null }> }
    const chainListeners = new Set<() => void>()
    const chainChanged = () => { setTimeout(() => chainListeners.forEach(l => l()), 0) }
    const adoChain = {
      list: async () => adoClone(adoMock.chains),
      start: async (input: ChainStart) => {
        adoCall('chainStart', input)
        const c = adoMock.settings.connections.find(x => x.id === input.connectionId)
        const now = Date.now()
        const chain = {
          id: `chain${adoMock.chains.length + 1}`, connectionId: input.connectionId,
          organization: c?.organization ?? '', project: c?.project ?? '', autoComplete: !!input.autoComplete, createdAt: now,
          items: input.items.map(i => ({
            side: i.side, repo: i.repo, branches: i.branches, ...(i.qaPr ? { qaPr: i.qaPr } : {}),
            status: i.qaPr ? 'waiting-qa' : 'creating-prod', updatedAt: now
          }))
        }
        adoMock.chains.push(chain)
        chainChanged()
        return adoClone(chain)
      },
      cancel: async (id: string) => {
        adoCall('chainCancel', id)
        for (const item of adoMock.chains.find(c => c.id === id)?.items ?? []) {
          if (item.status === 'waiting-qa' || item.status === 'creating-prod' || item.status === 'waiting-prod') item.status = 'cancelled'
        }
        chainChanged()
      },
      remove: async (id: string) => {
        adoCall('chainRemove', id)
        adoMock.chains = adoMock.chains.filter(c => c.id !== id)
        chainChanged()
      },
      onChanged: (cb: () => void) => {
        chainListeners.add(cb)
        return () => { chainListeners.delete(cb) }
      }
    }

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        platform: 'win32',
        sql,
        app: { initialTarget: async () => null, onOpenPath: () => () => {} },
        updater: {
          install: async () => ({ ok: true }),
          state: async () => ({ packaged: false, currentVersion: '0.0.0', status: 'idle' }),
          check: async () => ({ packaged: false, currentVersion: '0.0.0', status: 'idle' }),
          onState: () => () => {}
        },
        fs: { watch: async () => {}, unwatch: async () => {}, onChanged: () => () => {} },
        window: { minimize() {}, maximize() {}, close() {}, openDetached: async () => true },
        dialog: {
          openFolder: async () => null,
          openFile: async () => 'C:\\mock\\import.bacpac',
          saveSqlQuery: async (defaultName: string, content: string) => {
            ;(window as unknown as { __sqlMock: { savedQueries: Array<{ defaultName: string; content: string }> } }).__sqlMock.savedQueries.push({ defaultName, content })
            return `C:\\mock\\${defaultName}`
          }
        },
        ado,
        adoSettings,
        adoChain,
        export: {
          xlsx: async (defaultName: string, sheets: Array<{ name: string; columns: string[]; rows: unknown[][] }>) => {
            ;(window as unknown as { __sqlMock: { xlsx: unknown[] } }).__sqlMock.xlsx.push({ defaultName, sheets })
            return 'C:\\mock\\query_results.xlsx'
          }
        },
        clipboard: {
          write(text: string) {
            ;(window as unknown as { __sqlMock: { clipboard: string[] } }).__sqlMock.clipboard.push(text)
            navigator.clipboard.writeText(text).catch(() => {})
          }
        }
      }
    })
    ;(window as unknown as { __sqlMock?: { queries: string[]; completedQueries: string[]; diagramCalls: number; connectConfigs: unknown[]; savedQueries: Array<{ defaultName: string; content: string }>; xlsx: unknown[]; clipboard: string[]; restores: unknown[]; dataTiers: unknown[] } }).__sqlMock = {
      queries: [],
      clipboard: [],
      completedQueries: [],
      diagramCalls: 0,
      connectConfigs: [],
      savedQueries: [],
      xlsx: [],
      restores: [],
      dataTiers: []
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

/** Replaces the editor text and runs it (F5); call openMockDatabase first. */
export async function runEditorQuery(page: Page, text: string) {
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(text)
  await page.keyboard.press('Escape') // close IntelliSense, if open
  await page.keyboard.press('F5')
}

export interface SqlMockState {
  queries: string[]
  clipboard: string[]
  xlsx: Array<{ defaultName: string; sheets: Array<{ name: string; columns: string[]; rows: unknown[][] }> }>
}

/**
 * Reads what the mock recorded (queries, clipboard writes, xlsx exports…).
 * `pick` runs in the page, so only its result crosses over: an export of
 * 250k rows must not be serialized on every poll.
 */
export async function sqlMock<T>(page: Page, pick: (mock: SqlMockState) => T): Promise<T> {
  return page.evaluate(`(${pick.toString()})(window.__sqlMock)`) as Promise<T>
}

export async function openMockTables(page: Page) {
  await openMockDatabase(page)
  await page.getByLabel('tables massive_mock_db').click()
}

export interface AdoMockSeed {
  connections?: Array<{ id: string; organization: string; project: string }>
  folders?: Record<string, { connectionId: string; repository: string }>
  release?: Record<string, unknown>
  /** connection id -> has a PAT */
  tokens?: Record<string, boolean>
  catalog?: Record<string, { ok: true; repos: string[] } | { ok: false; error: string }>
  /** repositories a connection saved during the test reads */
  newRepos?: string[]
  /** `${repo}:${source}->${target}` -> commits */
  commits?: Record<string, Array<{ commitId: string; message: string; author: string }>>
  /** same keys -> Azure DevOps error (strict reads reject, lenient ones return []) */
  commitErrors?: Record<string, string>
  /** repo -> active pull requests */
  pullRequests?: Record<string, unknown[]>
  workItems?: Array<{ id: number; title: string; type: string; state: string; assignedTo: string; url: string }>
  /** release chains as main lists them (src/shared/adoChain.ts ReleaseChain) */
  chains?: unknown[]
}

/** Seeds the in-memory Azure DevOps settings for the next page load (runs after the fixture's init script). */
export async function seedAdo(page: Page, seed: AdoMockSeed) {
  await page.addInitScript((s) => {
    const m = (window as unknown as { __adoMock: Record<string, unknown> & { settings: Record<string, unknown> } }).__adoMock
    m.settings.connections = s.connections ?? []
    m.settings.folders = s.folders ?? {}
    m.settings.release = s.release ?? {}
    m.settings.tokens = s.tokens ?? {}
    m.catalog = s.catalog ?? {}
    if (s.newRepos) m.newRepos = s.newRepos
    if (s.commits) m.commits = s.commits
    if (s.commitErrors) m.commitErrors = s.commitErrors
    if (s.pullRequests) m.pullRequests = s.pullRequests
    if (s.workItems) m.workItems = s.workItems
    if (s.chains) m.chains = s.chains
  }, seed)
}

/**
 * Opens `repo` (a main checkout: git's common dir is `<repo>/.git`) from the
 * startup dialog, on the given panel.
 */
export async function openAdoRepo(page: Page, repo: string, panel: 'ado' | 'release') {
  await page.addInitScript(({ repo, panel }) => {
    localStorage.setItem('damnedide_recent_repos', JSON.stringify([repo]))
    localStorage.setItem('damnedide_last_panel', panel)
    ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI.git = {
      resolveRepoRoot: async (p: string) => p,
      gitCommonDir: async (p: string) => `${p}/.git`
    }
  }, { repo, panel })
  await page.goto('/')
  await page.getByText(repo, { exact: true }).click()
}

/** Arguments of every recorded adoSettings / ado call with that name, in order. */
export async function adoCalls(page: Page, name: string): Promise<unknown[][]> {
  return page.evaluate((n) =>
    (window as unknown as { __adoMock: { calls: Array<{ name: string; args: unknown[] }> } }).__adoMock.calls
      .filter(c => c.name === n)
      .map(c => c.args), name)
}

export { expect }
