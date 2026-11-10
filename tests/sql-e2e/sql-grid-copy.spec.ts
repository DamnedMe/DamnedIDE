import { test, expect, openMockDatabase, runEditorQuery, sqlMock } from './sql.fixture'

const lastCopy = async (page: import('@playwright/test').Page) => (await sqlMock(page, m => m.clipboard)).at(-1)
const cell = (page: import('@playwright/test').Page, row: number, column: string) =>
  page.locator(`[data-result-row="${row}"] [data-result-column="${column}"]`)

test('a single cell and a whole column can be copied with Ctrl+C and from the context menu', async ({ page }) => {
  await openMockDatabase(page)
  await runEditorQuery(page, 'SELECT * FROM dbo.Orders')
  await expect(page.getByText('2 rows', { exact: true })).toBeVisible()

  // a click marks the cell: Ctrl+C copies its value
  await cell(page, 0, 'Total').click()
  await expect(cell(page, 0, 'Total')).toHaveAttribute('data-active-cell', 'true')
  await page.keyboard.press('Control+C')
  await expect.poll(() => lastCopy(page)).toBe('99.5')

  // Alt+click selects the column: Ctrl+C copies all its values
  await cell(page, 0, 'Total').click({ modifiers: ['Alt'] })
  await page.keyboard.press('Control+C')
  await expect.poll(() => lastCopy(page)).toBe('99.5\n12')
  await expect(page.getByText('column «Total» copied: 2 values')).toBeVisible()

  // context menu of a cell
  await cell(page, 1, 'CustomerId').click({ button: 'right' })
  await page.getByText('copy cell value', { exact: true }).click()
  await expect.poll(() => lastCopy(page)).toBe('2')
  await cell(page, 1, 'CustomerId').click({ button: 'right' })
  await page.getByText('copy column «CustomerId» (2 values)', { exact: true }).click()
  await expect.poll(() => lastCopy(page)).toBe('1\n2')

  // several rows: Ctrl+C still copies the rows with header
  await cell(page, 0, 'Total').click()
  await cell(page, 1, 'Total').click({ modifiers: ['Control'] })
  await page.keyboard.press('Control+C')
  await expect.poll(() => lastCopy(page)).toBe('Id\tCustomerId\tTotal\n10\t1\t99.5\n11\t2\t12')
})
