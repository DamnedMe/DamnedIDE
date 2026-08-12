import { test, expect, openMockDatabase, openMockTables } from './sql.fixture'

test('a SELECT shows live operation feedback before results arrive', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()

  await expect(page.getByRole('status')).toContainText('Executing SELECT')
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()
})

test('essentials mode leaves only tables, diagram and programmability', async ({ page }) => {
  await openMockDatabase(page)
  await expect(page.getByText('views', { exact: true })).toBeVisible()
  await page.getByTestId('sql-essentials-toggle').click()

  await expect(page.getByText('tables', { exact: true })).toBeVisible()
  await expect(page.getByLabel('diagram massive_mock_db')).toBeVisible()
  await expect(page.getByText('programmability', { exact: true })).toBeVisible()
  await expect(page.getByText('views', { exact: true })).toHaveCount(0)
  await expect(page.getByText('essentials', { exact: true })).toBeVisible()
})

test('all mode also exposes the database diagram', async ({ page }) => {
  await openMockDatabase(page)

  await expect(page.getByText('all', { exact: true })).toBeVisible()
  await expect(page.getByLabel('diagram massive_mock_db')).toBeVisible()
  await expect(page.getByText('views', { exact: true })).toBeVisible()
  await expect(page.getByText('programmability', { exact: true })).toBeVisible()
  const firstDatabaseItems = await page.locator(
    '[aria-label="diagram massive_mock_db"], [aria-label="tables massive_mock_db"]'
  ).evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))
  expect(firstDatabaseItems).toEqual(['diagram massive_mock_db', 'tables massive_mock_db'])
})

test('object explorer search finds and reveals database objects', async ({ page }, testInfo) => {
  await openMockDatabase(page)

  const search = page.getByLabel('search object explorer')
  await search.fill('WideRows')
  const result = page.getByRole('button', { name: 'search result table dbo.WideRows' })
  await expect(result).toBeVisible()
  const screenshotPath = testInfo.outputPath('object-explorer-search.png')
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('object-explorer-search.png', { contentType: 'image/png', path: screenshotPath })
  await result.click()

  await expect(search).toHaveValue('')
  await expect(page.getByLabel('table dbo.WideRows')).toBeVisible()
})

test('opening a diagram gives the canvas most of the vertical workspace', async ({ page }) => {
  await openMockDatabase(page)
  await page.getByLabel('diagram massive_mock_db').click()
  await expect(page.getByRole('img', { name: 'database diagram massive_mock_db' })).toBeVisible()

  const editorHeight = (await page.locator('.monaco-editor').first().boundingBox())?.height || 0
  const diagramHeight = (await page.getByTestId('sql-diagram-view').boundingBox())?.height || 0
  expect(editorHeight).toBeLessThanOrEqual(145)
  expect(diagramHeight).toBeGreaterThan(editorHeight * 2.5)
})

test('diagram zoom responds to Ctrl plus, Ctrl minus and Ctrl wheel', async ({ page }) => {
  await openMockDatabase(page)
  await page.getByLabel('diagram massive_mock_db').click()
  const diagram = page.getByRole('img', { name: 'database diagram massive_mock_db' })
  await expect(diagram).toBeVisible()
  await diagram.focus()

  const zoom = page.getByTestId('diagram-zoom-level')
  const readZoom = async () => Number((await zoom.textContent())?.replace('%', '') || 0)
  const initial = await readZoom()
  await page.keyboard.down('Control')
  await page.keyboard.press('+')
  await page.keyboard.up('Control')
  await expect.poll(readZoom).toBeGreaterThan(initial)

  const afterPlus = await readZoom()
  await diagram.dispatchEvent('wheel', { deltaY: -100, ctrlKey: true })
  await expect.poll(readZoom).toBeGreaterThan(afterPlus)

  const beforeMinus = await readZoom()
  await page.keyboard.down('Control')
  await page.keyboard.press('-')
  await page.keyboard.up('Control')
  await expect.poll(readZoom).toBeLessThan(beforeMinus)
})

test('editing and deleting rows always require confirmation', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()

  const firstCode = page.getByRole('gridcell', { name: 'ROW-0000001', exact: true })
  await firstCode.dblclick()
  const editor = firstCode.locator('input')
  await editor.fill('ROW-EDITED')
  await editor.press('Enter')
  await expect(page.getByRole('dialog', { name: 'confirm update' })).toBeVisible()
  await page.getByRole('dialog', { name: 'confirm update' }).getByText('cancel', { exact: true }).click()

  const firstRow = page.locator('[data-result-row="0"]')
  await firstRow.click({ button: 'right' })
  await page.getByText('delete row', { exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'confirm delete' })).toBeVisible()
})

test('a 300-table cyclic diagram is generated within the UI budget', async ({ page }, testInfo) => {
  await openMockDatabase(page)
  const editorBefore = await page.locator('.monaco-editor').first().boundingBox()
  const started = Date.now()
  await page.getByLabel('diagram massive_mock_db').click()
  await expect(page.getByRole('status')).toContainText('Generating diagram')
  const editorDuring = await page.locator('.monaco-editor').first().boundingBox()
  expect(Math.abs((editorDuring?.y || 0) - (editorBefore?.y || 0))).toBeLessThan(2)
  const diagram = page.getByRole('img', { name: 'database diagram massive_mock_db' })
  await expect(diagram).toBeVisible({ timeout: 10_000 })
  const readyMs = Date.now() - started

  await expect(page.getByText('300 tables · 300 relations', { exact: false })).toBeVisible()
  expect(readyMs).toBeLessThan(8_000)
  await expect(diagram.locator('[data-diagram-table]')).toHaveCount(300)
  expect((await page.getByTestId('sql-diagram-view').boundingBox())?.height || 0).toBeGreaterThan(250)
  const diagramCalls = await page.evaluate(() => (window as unknown as { __sqlMock: { diagramCalls: number } }).__sqlMock.diagramCalls)
  expect(diagramCalls).toBe(1)

  const focusStarted = Date.now()
  await page.getByLabel('search diagram tables').fill('DiagramTable142')
  await page.getByLabel('search diagram tables').press('Enter')
  await expect(page.getByLabel('table details dbo.DiagramTable142')).toBeVisible()
  const focusedNodes = await diagram.locator('[data-diagram-table]').count()
  expect(focusedNodes).toBeLessThan(80)
  expect(Date.now() - focusStarted).toBeLessThan(1_000)

  const screenshotPath = testInfo.outputPath('diagram-focused.png')
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('diagram-focused.png', { contentType: 'image/png', path: screenshotPath })

  await testInfo.attach('diagram-performance.json', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ tables: 300, relations: 300, readyMs, focusedNodes }, null, 2))
  })
})
