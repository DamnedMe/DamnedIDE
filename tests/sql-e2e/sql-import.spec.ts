import { test, expect, openMockTables } from './sql.fixture'

// Import a database from a backup: the database context menu offers both
// sources, the .bak dialog restores server-side and the .bacpac one imports
// through SqlPackage.

test('import database: .bak restore and data-tier application', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('database massive_mock_db').click({ button: 'right' })

  await expect(page.getByText('importa da backup .bak…')).toBeVisible()
  await page.getByText('importa da backup .bak…').click()

  const dialog = page.getByRole('dialog', { name: 'import database' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('database di destinazione')).toHaveValue('massive_mock_db_restore')

  // restore from a server-side .bak
  await dialog.getByLabel('percorso backup sul server').fill('C:\\Backup\\db.bak')
  await dialog.getByRole('button', { name: 'ripristina' }).click()
  await expect(dialog.getByText(/restore completato/)).toBeVisible()
  await expect(dialog.locator('pre').filter({ hasText: 'RESTORE DATABASE' })).toContainText('massive_mock_db_restore')

  await expect.poll(() => page.evaluate(() => (window as unknown as { __sqlMock: { restores: unknown[] } }).__sqlMock.restores.length)).toBe(1)
  const restores = await page.evaluate(() => (window as unknown as {
    __sqlMock: { restores: Array<{ path: string; database: string; replace: boolean }> }
  }).__sqlMock.restores)
  expect(restores[0]).toEqual({ path: 'C:\\Backup\\db.bak', database: 'massive_mock_db_restore', replace: false })

  // switch to the data-tier application source
  await dialog.getByRole('button', { name: /Applicazione a livello dati/ }).click()
  await expect(dialog.getByLabel('database di destinazione')).toHaveValue('massive_mock_db_import')
  await dialog.getByRole('button', { name: 'sfoglia…' }).click()
  await expect(dialog.getByLabel('file bacpac')).toHaveValue('C:\\mock\\import.bacpac')
  await dialog.getByRole('button', { name: 'importa', exact: true }).click()
  await expect(dialog.getByText(/import completato/)).toBeVisible()

  await expect.poll(() => page.evaluate(() => (window as unknown as { __sqlMock: { dataTiers: unknown[] } }).__sqlMock.dataTiers.length)).toBe(1)
  const dataTiers = await page.evaluate(() => (window as unknown as {
    __sqlMock: { dataTiers: Array<{ database: string; action: string; file: string }> }
  }).__sqlMock.dataTiers)
  expect(dataTiers[0]).toEqual({ database: 'massive_mock_db_import', action: 'import', file: 'C:\\mock\\import.bacpac' })
})

test('the database menu opens the data-tier import directly', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('database massive_mock_db').click({ button: 'right' })
  await page.getByText('importa applicazione a livello dati (.bacpac)…').click()

  const dialog = page.getByRole('dialog', { name: 'import database' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('file bacpac')).toBeVisible()
  await expect(dialog.getByLabel('database di destinazione')).toHaveValue('massive_mock_db_import')
})
