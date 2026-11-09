import type { Locator, Page } from '@playwright/test'
import { test, expect, openMockDatabase, runEditorQuery, sqlMock } from './sql.fixture'

// Orders o JOIN Customers c LEFT JOIN Notes n (Notes has no key): SELECT *
// returns two `Id` columns, merged by mssql into one array value.
const JOIN = 'SELECT * FROM dbo.Orders o JOIN dbo.Customers c ON c.Id = o.CustomerId LEFT JOIN dbo.Notes n ON n.OrderId = o.Id'

async function editCell(scope: Page | Locator, row: number, column: string, value: string) {
  const target = scope.locator(`[data-result-row="${row}"] [data-result-column="${column}"]`)
  await target.dblclick()
  const input = target.locator('input')
  await input.fill(value)
  await input.press('Enter')
}

const confirmation = (page: Page, kind: 'update' | 'delete') => page.getByRole('dialog', { name: `confirm ${kind}` })
const statementIn = async (page: Page, kind: 'update' | 'delete') => confirmation(page, kind).locator('pre').textContent()
// the queries sent to the mock server, line endings normalized (Monaco keeps CRLF on Windows)
const queries = async (page: Page) => (await sqlMock(page, m => m.queries)).map(q => q.replace(/\r\n/g, '\n'))

test('in a join every column is saved to its own table and key, behind the confirmation', async ({ page }) => {
  await openMockDatabase(page)
  await runEditorQuery(page, JOIN)
  await expect(page.getByText('2 rows', { exact: true })).toBeVisible()

  await editCell(page, 0, 'Total', '120')
  await expect(confirmation(page, 'update')).toBeVisible()
  expect(await statementIn(page, 'update')).toBe('UPDATE [dbo].[Orders]\nSET [Total] = 120\nWHERE [Id] = 10')
  await confirmation(page, 'update').getByText('run update', { exact: true }).click()
  await expect.poll(async () => (await queries(page)).some(q => q.endsWith('UPDATE [dbo].[Orders]\nSET [Total] = 120\nWHERE [Id] = 10'))).toBe(true)
  // the grid comes back by re-running the query that produced it
  await expect.poll(async () => (await queries(page)).at(-1)?.endsWith(JOIN)).toBe(true)
  await expect(page.locator('[data-result-row="1"] [data-result-column="Name"]')).toBeVisible()

  // a joined column writes to the joined table, by that table's key
  await editCell(page, 1, 'Name', 'Bea')
  expect(await statementIn(page, 'update')).toBe("UPDATE [dbo].[Customers]\nSET [Name] = N'Bea'\nWHERE [Id] = 2")
  await confirmation(page, 'update').getByText('cancel', { exact: true }).click()

  // a row delete targets the base table of the FROM
  await page.locator('[data-result-row="0"] [data-result-column="Code"]').click({ button: 'right' })
  await page.getByText('delete row', { exact: true }).click()
  expect(await statementIn(page, 'delete')).toBe('DELETE FROM [dbo].[Orders]\nWHERE [Id] = 10')
})

test('an ambiguous join edit is refused with an Italian message and writes nothing', async ({ page }) => {
  await openMockDatabase(page)
  await runEditorQuery(page, JOIN)
  await expect(page.getByText('2 rows', { exact: true })).toBeVisible()
  const sent = (await queries(page)).length

  // two tables share the column name
  await page.locator('[data-result-row="0"] [data-result-column="Id"]').dblclick()
  await expect(page.getByText(/Modifica rifiutata: più colonne si chiamano «Id» \(dbo\.Orders e dbo\.Customers\)/)).toBeVisible()
  // the column comes from a table without a usable key
  await page.locator('[data-result-row="0"] [data-result-column="Note"]').dblclick()
  await expect(page.getByText(/la tabella dbo\.Notes non ha una chiave primaria o univoca/)).toBeVisible()

  await expect(page.locator('[data-result-column] input')).toHaveCount(0)
  await expect(confirmation(page, 'update')).toHaveCount(0)
  expect((await queries(page)).filter(q => /UPDATE/.test(q))).toHaveLength(0)
  expect((await queries(page)).length).toBe(sent)
})

test('in a batch each result set is edited through its own statement and the batch refreshes', async ({ page }) => {
  const batch = 'SELECT * FROM dbo.Orders\nSELECT * FROM dbo.Customers'
  await openMockDatabase(page)
  await runEditorQuery(page, batch)
  const second = page.getByRole('region', { name: 'Result set 2' })
  await expect(second).toContainText('Result set 2 · dbo.Customers')

  await editCell(second, 0, 'Name', 'Adele')
  expect(await statementIn(page, 'update')).toBe("UPDATE [dbo].[Customers]\nSET [Name] = N'Adele'\nWHERE [Id] = 1")
  await confirmation(page, 'update').getByText('run update', { exact: true }).click()
  await expect.poll(async () => (await queries(page)).at(-1)?.endsWith(batch)).toBe(true)
  await expect(page.getByRole('region', { name: 'Result set 2' })).toBeVisible()

  // a result set of an EXEC cannot be tied to its statement: refused, not guessed
  await runEditorQuery(page, "sp_help 'dbo.MassiveRows'")
  await page.getByRole('region', { name: 'Result set 2' }).locator('[data-result-row="0"] [data-result-column="Type"]').dblclick()
  await expect(page.getByText(/il result set 2 viene da EXEC/)).toBeVisible()
})

test('running one query of several in the editor edits that query table and refreshes only it', async ({ page }) => {
  await openMockDatabase(page)
  await runEditorQuery(page, 'SELECT * FROM dbo.Customers\nSELECT * FROM dbo.Orders')
  await expect(page.getByTestId('sql-multi-result')).toBeVisible()

  // select the second line only and run it
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('F5')
  await expect(page.getByTestId('sql-multi-result')).toHaveCount(0)
  await expect(page.locator('[data-result-row="1"] [data-result-column="Total"]')).toBeVisible()

  // the first FROM of the editor is Customers: the edit must still go to Orders
  await editCell(page, 1, 'Total', '15')
  expect(await statementIn(page, 'update')).toBe('UPDATE [dbo].[Orders]\nSET [Total] = 15\nWHERE [Id] = 11')
  await confirmation(page, 'update').getByText('run update', { exact: true }).click()
  await expect.poll(async () => (await queries(page)).at(-1)).toMatch(/\nSELECT \* FROM dbo\.Orders$/)
  expect((await queries(page)).at(-1)).not.toContain('Customers')
})
