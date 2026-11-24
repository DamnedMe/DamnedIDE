import { test, expect, sqlMock } from './sql.fixture'

test('the new query button is the first item of the tab row', async ({ page }) => {
  const chrome = page.locator('.sql-query-editor__chrome')
  const first = chrome.locator('button').first()
  await expect(first).toHaveAttribute('aria-label', 'new query tab')
  await first.click()
  await expect(page.getByTitle('Query 2')).toBeVisible()
})

test('new connection and the sidebar toggle sit at the top of the left column', async ({ page }) => {
  const actions = page.locator('.sql-sidebar__actions')
  await expect(actions.getByLabel('Connection', { exact: true })).toBeVisible()
  await actions.getByLabel('collapse connections').click()
  // collapsed: the toggle moves next to the page title, so the sidebar can come back
  await page.locator('.sql-page-title').getByLabel('show connections').click()
  await expect(actions.getByLabel('Connection', { exact: true })).toBeVisible()
})

test('the SQL files panel opens a folder showing only folders and .sql files', async ({ page }) => {
  await page.getByRole('tab', { name: 'SQL files' }).click()
  await page.getByRole('button', { name: 'Open folder' }).click()
  const panel = page.locator('.sql-files')
  await expect(panel.getByLabel('open file offerte.sql')).toBeVisible()
  await expect(panel.getByText('notes.txt')).toHaveCount(0)
  await expect(panel.getByText('node_modules')).toHaveCount(0)

  await panel.getByLabel('folder report').click()
  await expect(panel.getByLabel('open file assets.SQL')).toBeVisible()

  await panel.getByLabel('open file offerte.sql').click()
  // the empty first tab is reused for the file
  await expect(page.getByTitle('offerte', { exact: true })).toBeVisible()
  await expect(page.getByTitle('Query 1')).toHaveCount(0)

  await panel.getByLabel('open file assets.SQL').click()
  await expect(page.getByTitle('assets', { exact: true })).toBeVisible()
  // a file already open is activated, not opened twice
  await panel.getByLabel('open file offerte.sql').click()
  await expect(page.getByTitle('offerte', { exact: true })).toHaveCount(1)
  await expect(page.getByTitle('offerte', { exact: true })).toHaveAttribute('data-active', 'true')
})

test('a single .sql file can be opened from the panel', async ({ page }) => {
  await page.getByRole('tab', { name: 'SQL files' }).click()
  await page.getByRole('button', { name: 'Open file', exact: true }).click()
  await expect(page.getByTitle('hotfix', { exact: true })).toBeVisible()
  await expect(page.locator('.sql-files').getByLabel('open file hotfix.sql')).toBeVisible()
})

test('dropping .sql files on the query area opens them in tabs', async ({ page }) => {
  const editor = page.getByLabel('Query editor')
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['SELECT 1;'], 'vendite_q3.sql', { type: 'application/sql' }))
    transfer.items.add(new File(['SELECT 2;'], 'clienti.sql', { type: 'application/sql' }))
    transfer.items.add(new File(['x'], 'readme.md', { type: 'text/markdown' }))
    return transfer
  })
  await editor.dispatchEvent('dragenter', { dataTransfer })
  await editor.dispatchEvent('dragover', { dataTransfer })
  await expect(page.getByText('Drop to open the .sql file')).toBeVisible()
  await editor.dispatchEvent('drop', { dataTransfer })
  await expect(page.getByText('Drop to open the .sql file')).toHaveCount(0)
  await expect(page.getByTitle('vendite_q3', { exact: true })).toBeVisible()
  await expect(page.getByTitle('clienti', { exact: true })).toBeVisible()
  await expect(page.getByTitle('readme', { exact: true })).toHaveCount(0)
})

test('saving a tab opened from a file writes the file in place; save as asks where', async ({ page }) => {
  await page.getByRole('tab', { name: 'SQL files' }).click()
  await page.getByRole('button', { name: 'Open folder' }).click()
  await page.locator('.sql-files').getByLabel('open file offerte.sql').click()

  await page.getByTitle('offerte', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Save query', exact: true }).click()
  await expect.poll(() => sqlMock(page, mock => mock.writtenFiles)).toEqual([
    { file: 'C:\\mock\\scripts\\offerte.sql', content: '-- offerte.sql\nSELECT 1;' }
  ])
  expect(await sqlMock(page, mock => mock.savedQueries)).toEqual([])

  await page.getByTitle('offerte', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Save query as…' }).click()
  await expect.poll(() => sqlMock(page, mock => mock.savedQueries.map(item => item.defaultName))).toEqual(['offerte.sql'])
})
