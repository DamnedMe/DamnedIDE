import { test, expect, openMockTables } from './sql.fixture'

test('column header sorting and filtering rewrite and execute the visible SQL', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'sort Id' }).click()
  await expect(page.getByLabel('sort priority Id 1 ascending')).toBeVisible()
  await expect.poll(async () => {
    const queries = await page.evaluate(() => (window as unknown as { __sqlMock: { completedQueries: string[] } }).__sqlMock.completedQueries)
    return queries.some(query => /ORDER BY \[MassiveRows\]\.\[Id\] ASC/i.test(query))
  }).toBe(true)

  await page.getByRole('button', { name: 'filter Amount' }).click()
  const popover = page.getByRole('dialog', { name: 'filter Amount' })
  await popover.getByLabel('filter operator').selectOption('gt')
  await popover.getByLabel('filter value').fill('100')
  await popover.getByRole('button', { name: 'apply filter' }).click()

  await expect(page.getByLabel('active filter Amount')).toBeVisible()
  await expect.poll(async () => {
    const queries = await page.evaluate(() => (window as unknown as { __sqlMock: { completedQueries: string[] } }).__sqlMock.completedQueries)
    return queries.some(query => /\[MassiveRows\]\.\[Amount\]\s*>\s*100[\s\S]*ORDER BY \[MassiveRows\]\.\[Id\] ASC/i.test(query))
  }).toBe(true)
})

test('Shift click creates multi-column sorting and clear all restores the base query', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'sort Region' }).click()
  await page.getByRole('button', { name: 'sort City' }).click({ modifiers: ['Shift'] })
  await expect(page.getByLabel('sort priority Region 1 ascending')).toBeVisible()
  await expect(page.getByLabel('sort priority City 2 ascending')).toBeVisible()
  await page.getByRole('button', { name: 'clear all grid filters and sorting' }).click()
  await expect(page.getByLabel('sort priority Region 1 ascending')).toHaveCount(0)
  await expect(page.getByLabel('sort priority City 2 ascending')).toHaveCount(0)
})

test('NULL filters are server-side and complex queries explain why rewriting is disabled', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()

  const grid = page.getByLabel('query results grid')
  await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; element.dispatchEvent(new Event('scroll')) })
  await page.getByRole('button', { name: 'filter Notes' }).click()
  const filter = page.getByRole('dialog', { name: 'filter Notes' })
  await filter.getByLabel('filter operator').selectOption('isNull')
  await filter.getByRole('button', { name: 'apply filter' }).click()
  await expect.poll(async () => {
    const queries = await page.evaluate(() => (window as unknown as { __sqlMock: { completedQueries: string[] } }).__sqlMock.completedQueries)
    return queries.some(query => /\[MassiveRows\]\.\[Notes\] IS NULL/i.test(query))
  }).toBe(true)

  const editor = page.locator('.monaco-editor')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText('WITH rows AS (SELECT * FROM dbo.MassiveRows) SELECT * FROM rows')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByText('CTE, set operations and grouped queries are read-only in the grid.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'sort Id' })).toBeDisabled()
})
