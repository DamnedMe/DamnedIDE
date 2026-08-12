import { test, expect, openMockTables } from './sql.fixture'

test('query tabs and executed query history survive a reload', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()
  await expect(page.getByTitle('Query 2')).toBeVisible()

  await page.getByLabel('open SQL workspace').click()
  await expect(page.getByRole('complementary', { name: 'SQL workspace' })).toBeVisible()
  await expect(page.getByText('history', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /MassiveRows/ }).first()).toBeVisible()

  await page.reload()
  await expect(page.getByText('SQL Server', { exact: true })).toBeVisible()
  await expect(page.getByTitle('Query 2')).toBeVisible()
  await page.getByTitle('Query 2').click()
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('MassiveRows')
})

test('a history entry can be favorited and reopened in a new query tab', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.AuditLog').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('1 rows', { exact: true })).toBeVisible()

  await page.getByLabel('open SQL workspace').click()
  const historyItem = page.getByTestId('sql-history-item').first()
  await historyItem.getByLabel('add query to favorites').click()
  await page.getByRole('button', { name: 'favorites', exact: true }).click()
  const favorite = page.getByTestId('sql-favorite-item').first()
  await expect(favorite).toContainText('AuditLog')
  await favorite.getByRole('button', { name: /open/i }).click()
  await expect(page.getByTitle('Query 3')).toBeVisible()
})

test('the workspace can create a query and activate an existing query tab', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('open SQL workspace').click()
  await page.getByRole('button', { name: 'workspace', exact: true }).click()
  await page.getByRole('button', { name: 'add query to workspace' }).click()
  await expect(page.getByTitle('Query 2')).toBeVisible()

  await page.getByLabel('open SQL workspace').click()
  await page.getByRole('button', { name: 'workspace', exact: true }).click()
  await page.getByRole('button', { name: 'open Query 1' }).click()
  await expect(page.getByTitle('Query 1')).toHaveCSS('color', /.+/)
  await expect(page.getByRole('complementary', { name: 'SQL workspace' })).toHaveCount(0)
})
