import { test, expect, openMockTables } from './sql.fixture'

test('the user can work with multiple SQL query tabs', async ({ page }) => {
  await expect(page.getByTitle('Query 1')).toBeVisible()
  await page.getByLabel('new query tab').click()
  await expect(page.getByTitle('Query 2')).toBeVisible()
  await page.getByLabel('close Query 2').click()
  await expect(page.getByTitle('Query 2')).toHaveCount(0)
  await expect(page.getByTitle('Query 1')).toBeVisible()
})

test('middle click closes a query tab', async ({ page }) => {
  await page.getByLabel('new query tab').click()
  await expect(page.getByTitle('Query 2')).toBeVisible()
  await page.getByTitle('Query 2').click({ button: 'middle' })
  await expect(page.getByTitle('Query 2')).toHaveCount(0)
  await expect(page.getByTitle('Query 1')).toBeVisible()
})

test('query tab context menu renames and saves the SQL file', async ({ page }) => {
  const editor = page.locator('.monaco-editor').first()
  await editor.click()
  await page.keyboard.insertText('SELECT 42 AS Answer;')

  await page.getByTitle('Query 1').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'query tab actions' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Rename' }).click()
  const rename = page.getByLabel('rename Query 1')
  await rename.fill('Answer query')
  await rename.press('Enter')
  await expect(page.getByTitle('Answer query')).toBeVisible()

  await page.getByTitle('Answer query').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Save query' }).click()
  await expect.poll(async () => page.evaluate(() => {
    const saved = (window as unknown as { __sqlMock: { savedQueries: Array<{ defaultName: string; content: string }> } }).__sqlMock.savedQueries
    return saved.at(-1)
  })).toEqual({ defaultName: 'Answer query.sql', content: 'SELECT 42 AS Answer;' })
  await expect(page.getByTitle('Answer query')).not.toContainText('•')
})

test('switching query tabs restores the result set produced by each tab', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()

  await page.getByLabel('table dbo.AuditLog').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('1 rows', { exact: true })).toBeVisible()

  await page.getByTitle('Query 2').click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()
  await page.getByTitle('Query 3').click()
  await expect(page.getByText('1 rows', { exact: true })).toBeVisible()
})
