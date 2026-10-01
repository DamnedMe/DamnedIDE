import { test, expect, openMockTables } from './sql.fixture'

async function runMassiveRows(page: import('@playwright/test').Page) {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()
}

test('the export menu offers csv, sql and xlsx; xlsx keeps the cell types', async ({ page }) => {
  await runMassiveRows(page)

  await page.getByRole('button', { name: 'esporta' }).click()
  await expect(page.getByRole('menu', { name: 'formato di esportazione' })).toBeVisible()
  await expect(page.getByTestId('export-file-csv')).toBeVisible()
  await expect(page.getByTestId('export-file-sql')).toBeVisible()
  await page.getByTestId('export-file-xlsx').click()

  await expect.poll(() => page.evaluate(() => (window as unknown as { __sqlMock: { xlsx: unknown[] } }).__sqlMock.xlsx.length)).toBe(1)
  const calls = await page.evaluate(() => (window as unknown as {
    __sqlMock: { xlsx: Array<{ defaultName: string; sheetName: string; columns: string[]; rows: unknown[][] }> }
  }).__sqlMock.xlsx)
  const call = calls[0]
  expect(call.defaultName).toBe('query_results.xlsx')
  expect(call.sheetName).toBe('MassiveRows')
  expect(call.columns.slice(0, 3)).toEqual(['Id', 'ParentId', 'Code'])
  expect(call.rows.length).toBeGreaterThan(100)
  // numbers/booleans keep their type, nulls stay empty cells
  expect(call.rows[0][0]).toBe(1)
  expect(call.rows[0][2]).toBe('ROW-0000001')
  expect(call.rows[0][8]).toBe(false) // IsActive: index % 3 !== 0
  expect(call.rows[11][8]).toBe(true)
  expect(call.rows[11][11]).toBeNull() // Notes: null every 11 rows
})
