import { readFileSync } from 'fs'
import type { Download } from '@playwright/test'
import { test, expect, openMockDatabase, openMockTables, runEditorQuery, sqlMock } from './sql.fixture'

async function runMassiveRows(page: import('@playwright/test').Page) {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()
}

test('the export menu offers csv, sql and xlsx; xlsx keeps the cell types', async ({ page }) => {
  await runMassiveRows(page)

  await page.getByRole('button', { name: 'export' }).click()
  await expect(page.getByRole('menu', { name: 'export format' })).toBeVisible()
  await expect(page.getByTestId('export-file-csv')).toBeVisible()
  await expect(page.getByTestId('export-file-sql')).toBeVisible()
  await page.getByTestId('export-file-xlsx').click()

  await expect.poll(() => sqlMock(page, m => m.xlsx.length)).toBe(1)
  // 250k rows: read back only what is checked
  const call = await sqlMock(page, m => ({
    defaultName: m.xlsx[0].defaultName,
    sheets: m.xlsx[0].sheets.map(s => ({ name: s.name, columns: s.columns, rowCount: s.rows.length, rows: s.rows.slice(0, 12) }))
  }))
  expect(call.defaultName).toBe('query_results.xlsx')
  expect(call.sheets).toHaveLength(1)
  const sheet = call.sheets[0]
  expect(sheet.name).toBe('MassiveRows')
  expect(sheet.columns.slice(0, 3)).toEqual(['Id', 'ParentId', 'Code'])
  expect(sheet.rowCount).toBeGreaterThan(100)
  // numbers/booleans keep their type, nulls stay empty cells
  expect(sheet.rows[0][0]).toBe(1)
  expect(sheet.rows[0][2]).toBe('ROW-0000001')
  expect(sheet.rows[0][8]).toBe(false) // IsActive: index % 3 !== 0
  expect(sheet.rows[11][8]).toBe(true)
  expect(sheet.rows[11][11]).toBeNull() // Notes: null every 11 rows
})

test('the grid exports the selected rows as an aligned text table to the clipboard', async ({ page }) => {
  await runMassiveRows(page)
  await page.locator('[data-result-row="0"] [data-result-column="Code"]').click()
  await page.locator('[data-result-row="1"] [data-result-column="Code"]').click({ modifiers: ['Control'] })

  await page.getByRole('button', { name: 'export' }).click()
  await page.getByTestId('export-text-clipboard').click()

  await expect.poll(async () => (await sqlMock(page, m => m.clipboard)).length).toBe(1)
  const lines = (await sqlMock(page, m => m.clipboard))[0].split('\n')
  expect(lines).toHaveLength(4) // header, separator, two rows
  expect(lines[0]).toMatch(/^\| +Id \| ParentId \| Code +\| Region/)
  expect(lines[1]).toMatch(/^\|-+:\|-+:\|-+\|/) // numeric columns right-aligned
  expect(lines[2]).toContain('| ROW-0000001 |')
  expect(lines[3]).toContain('| ROW-0000002 |')
  expect(new Set(lines.map(line => line.length)).size).toBe(1) // every line equally wide
  await expect(page.getByText('text table copied to the clipboard: 2 rows')).toBeVisible()
})

test('several result sets export in one go: the chosen ones, one sheet, file or text block each', async ({ page }) => {
  await openMockDatabase(page)
  await runEditorQuery(page, 'SELECT * FROM dbo.Orders\nSELECT * FROM dbo.Customers\nSELECT * FROM dbo.Orders')
  await expect(page.getByRole('region', { name: 'Result set 3' })).toBeVisible()
  const menu = page.getByRole('menu', { name: 'export several result sets' })

  await page.getByRole('button', { name: 'export all' }).click()
  await menu.getByLabel('export result set 3').uncheck()
  await menu.getByTestId('export-file-xlsx').click()
  await expect.poll(async () => (await sqlMock(page, m => m.xlsx)).length).toBe(1)
  const workbook = (await sqlMock(page, m => m.xlsx))[0]
  expect(workbook.sheets.map(sheet => sheet.name)).toEqual(['Orders', 'Customers'])
  expect(workbook.sheets[1].columns).toEqual(['Id', 'Name', 'Code'])
  expect(workbook.sheets[1].rows).toEqual([[1, 'Ada', 'C1'], [2, 'Bob', 'C2']])

  // the choice stays while the results stay
  await page.getByRole('button', { name: 'export all' }).click()
  await expect(menu.getByLabel('export result set 3')).not.toBeChecked()
  await menu.getByTestId('export-text-clipboard').click()
  await expect.poll(async () => (await sqlMock(page, m => m.clipboard)).length).toBe(1)
  expect((await sqlMock(page, m => m.clipboard))[0]).toBe([
    'Result set 1 · dbo.Orders · 2 rows',
    '|  Id | CustomerId | Total |',
    '|----:|-----------:|------:|',
    '|  10 |          1 |  99.5 |',
    '|  11 |          2 |    12 |',
    '',
    'Result set 2 · dbo.Customers · 2 rows',
    '|  Id | Name | Code |',
    '|----:|------|------|',
    '|   1 | Ada  | C1   |',
    '|   2 | Bob  | C2   |'
  ].join('\n'))

  await page.getByRole('button', { name: 'export all' }).click()
  const [script] = await Promise.all([page.waitForEvent('download'), menu.getByTestId('export-file-sql').click()])
  expect(script.suggestedFilename()).toBe('query_results.sql')
  const sql = readFileSync(await script.path(), 'utf8')
  expect(sql).toContain('-- Result set 1\n-- 2 rows from [dbo].[Orders]\nINSERT INTO [dbo].[Orders] ([Id], [CustomerId], [Total])')
  expect(sql).toContain('-- Result set 2\n-- 2 rows from [dbo].[Customers]')
  expect(sql).not.toContain('Result set 3')

  const downloads: Download[] = []
  page.on('download', download => downloads.push(download))
  await page.getByRole('button', { name: 'export all' }).click()
  await menu.getByTestId('export-file-csv').click()
  await expect.poll(() => downloads.length).toBe(2)
  expect(downloads.map(d => d.suggestedFilename())).toEqual(['query_results_1.csv', 'query_results_2.csv'])
  expect(readFileSync(await downloads[1].path(), 'utf8')).toBe('Id,Name,Code\r\n1,Ada,C1\r\n2,Bob,C2')
})
