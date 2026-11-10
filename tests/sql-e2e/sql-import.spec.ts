import { test, expect, openMockTables } from './sql.fixture'

// Import a database from a backup: the database context menu offers both
// sources, the .bak dialog restores server-side and the .bacpac one imports
// through SqlPackage.

test('import database: .bak restore and data-tier application', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('database massive_mock_db').click({ button: 'right' })

  await expect(page.getByText('import from .bak backup…')).toBeVisible()
  await page.getByText('import from .bak backup…').click()

  const dialog = page.getByRole('dialog', { name: 'import database' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('destination database')).toHaveValue('massive_mock_db_restore')

  // restore from a server-side .bak
  await dialog.getByLabel('backup path on the server').fill('C:\\Backup\\db.bak')
  await dialog.getByRole('button', { name: 'restore', exact: true }).click()
  await expect(dialog.getByText(/restore completed/)).toBeVisible()
  await expect(dialog.locator('pre').filter({ hasText: 'RESTORE DATABASE' })).toContainText('massive_mock_db_restore')

  await expect.poll(() => page.evaluate(() => (window as unknown as { __sqlMock: { restores: unknown[] } }).__sqlMock.restores.length)).toBe(1)
  const restores = await page.evaluate(() => (window as unknown as {
    __sqlMock: { restores: Array<{ path: string; database: string; replace: boolean }> }
  }).__sqlMock.restores)
  expect(restores[0]).toEqual({ path: 'C:\\Backup\\db.bak', database: 'massive_mock_db_restore', replace: false })

  // switch to the data-tier application source
  await dialog.getByRole('button', { name: /Data-tier application/ }).click()
  await expect(dialog.getByLabel('destination database')).toHaveValue('massive_mock_db_import')
  await dialog.getByRole('button', { name: 'browse…' }).click()
  await expect(dialog.getByLabel('bacpac file')).toHaveValue('C:\\mock\\import.bacpac')
  await dialog.getByRole('button', { name: 'import', exact: true }).click()
  await expect(dialog.getByText(/import completed/)).toBeVisible()

  await expect.poll(() => page.evaluate(() => (window as unknown as { __sqlMock: { dataTiers: unknown[] } }).__sqlMock.dataTiers.length)).toBe(1)
  const dataTiers = await page.evaluate(() => (window as unknown as {
    __sqlMock: { dataTiers: Array<{ database: string; action: string; file: string }> }
  }).__sqlMock.dataTiers)
  expect(dataTiers[0]).toEqual({ database: 'massive_mock_db_import', action: 'import', file: 'C:\\mock\\import.bacpac' })
})

test('the database menu opens the data-tier import directly', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('database massive_mock_db').click({ button: 'right' })
  await page.getByText('import data-tier application (.bacpac)…').click()

  const dialog = page.getByRole('dialog', { name: 'import database' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('bacpac file')).toBeVisible()
  await expect(dialog.getByLabel('destination database')).toHaveValue('massive_mock_db_import')
})
