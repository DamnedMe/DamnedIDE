import { test, expect, openMockTables } from './sql.fixture'

test('the user can work with multiple SQL query tabs', async ({ page }) => {
  await expect(page.getByTitle('Query 1')).toBeVisible()
  await page.getByLabel('new query tab').click()
  await expect(page.getByTitle('Query 2')).toBeVisible()
  await page.getByLabel('close Query 2').click()
  await expect(page.getByTitle('Query 2')).toHaveCount(0)
  await expect(page.getByTitle('Query 1')).toBeVisible()
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
