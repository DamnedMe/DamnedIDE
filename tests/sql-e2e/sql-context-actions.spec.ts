import { test, expect, openMockTables } from './sql.fixture'

test('context-menu SELECT opens a new query tab and executes it', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()

  await expect(page.getByTitle('Query 2')).toBeVisible()
  const editor = page.locator('.monaco-editor .view-lines')
  await expect(editor).toContainText('SELECT TOP (1000)')
  await expect(editor).toContainText('[Id]')
  await expect(editor).toContainText('[ParentId]')
  await expect(editor).not.toContainText('*')
  const editorBox = await page.locator('.monaco-editor').boundingBox()
  expect(editorBox).not.toBeNull()
  expect(editorBox!.height).toBeGreaterThanOrEqual(180)
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()
  const queries = await page.evaluate(() => (window as unknown as { __sqlMock: { queries: string[] } }).__sqlMock.queries)
  expect(queries.some(query => /SELECT TOP \(1000\)[\s\S]*\[Id\][\s\S]*\[Notes\][\s\S]*FROM \[dbo\]\.\[MassiveRows\]/i.test(query))).toBe(true)
})

test('context-menu SELECT remains visible when Monaco finishes loading after the tab was created', async ({ page }) => {
  await page.route(/monaco/i, async route => {
    await new Promise(resolve => setTimeout(resolve, 1200))
    await route.continue()
  })
  await page.reload()
  await expect(page.getByText('SQL Server', { exact: true })).toBeVisible()

  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()

  await expect(page.getByTitle('Query 2')).toBeVisible()
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('SELECT TOP (1000)', { timeout: 10_000 })
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('[MassiveRows].[Id]')

  await page.getByLabel('new query tab').click()
  await page.getByTitle('Query 2').click()
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('SELECT TOP (1000)')
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('[MassiveRows].[Id]')
})

test('TOP N and SELECT all context actions also enumerate every column', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top N rows…', { exact: true }).click()
  const topDialog = page.getByRole('dialog', { name: 'select top n rows' })
  await topDialog.getByRole('textbox').fill('25')
  await topDialog.getByText('run', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()

  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select all rows', { exact: true }).click()
  await page.getByRole('dialog', { name: 'select all rows' }).getByText('select all', { exact: true }).click()
  await expect(page.getByTitle('Query 3')).toBeVisible()

  const queries = await page.evaluate(() => (window as unknown as { __sqlMock: { queries: string[] } }).__sqlMock.queries)
  expect(queries.some(query => /SELECT TOP \(25\)[\s\S]*\[Id\][\s\S]*\[Notes\][\s\S]*FROM \[dbo\]\.\[MassiveRows\]/i.test(query))).toBe(true)
  expect(queries.some(query => /SELECT\s+[\s\S]*\[Id\][\s\S]*\[Notes\][\s\S]*FROM \[dbo\]\.\[MassiveRows\]/i.test(query) && !/TOP/i.test(query))).toBe(true)
  expect(queries.some(query => /SELECT(?: TOP \(\d+\))?\s+\*/i.test(query))).toBe(false)
})

test('clicking an FK adds and immediately executes the related JOIN', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()

  await page.getByRole('gridcell', { name: '1', exact: true }).nth(1).click()
  await expect.poll(async () => {
    const queries = await page.evaluate(() => (
      window as unknown as { __sqlMock: { completedQueries: string[] } }
    ).__sqlMock.completedQueries)
    return queries.some(query =>
      /\[fk1\]\.\[Id\]\s+AS\s+\[Parent · fk1\.Id\]/i.test(query) &&
      /LEFT JOIN \[dbo\]\.\[Parent\]/i.test(query))
  }).toBe(true)

  const grid = page.getByLabel('query results grid')
  await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; element.dispatchEvent(new Event('scroll')) })
  await expect(page.getByLabel('column group joined Parent · fk1')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Parent · fk1.Id', exact: true })).toBeVisible()
})

test('two foreign keys to the same table create distinct JOIN aliases', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.AuditLog').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('1 rows', { exact: true })).toBeVisible()

  await page.locator('[data-result-column="CreatedById"]').click()
  await expect.poll(async () => {
    const queries = await page.evaluate(() => (window as unknown as { __sqlMock: { queries: string[] } }).__sqlMock.queries)
    return queries.some(query => /JOIN \[dbo\]\.\[Users\] AS \[fk1\][\s\S]*\[AuditLog\]\.\[CreatedById\]/.test(query))
  }).toBe(true)
  await page.waitForTimeout(250)
  await page.locator('[data-result-column="UpdatedById"]').click()
  await expect.poll(async () => {
    const queries = await page.evaluate(() => (window as unknown as { __sqlMock: { queries: string[] } }).__sqlMock.queries)
    return queries.some(query =>
      /JOIN \[dbo\]\.\[Users\] AS \[fk1\][\s\S]*\[AuditLog\]\.\[CreatedById\]/.test(query) &&
      /JOIN \[dbo\]\.\[Users\] AS \[fk2\][\s\S]*\[AuditLog\]\.\[UpdatedById\]/.test(query))
  }).toBe(true)
  await page.waitForTimeout(250)
  await page.locator('[data-result-column="UpdatedById"]').click()
  await expect(page.getByText('join non aggiunta: questa relazione è già presente nella query')).toBeVisible()

  await expect.poll(async () => {
    const queries = await page.evaluate(() => (window as unknown as { __sqlMock: { queries: string[] } }).__sqlMock.queries)
    return queries.some(query =>
      /JOIN \[dbo\]\.\[Users\] AS \[fk1\][\s\S]*\[AuditLog\]\.\[CreatedById\]/.test(query) &&
      /JOIN \[dbo\]\.\[Users\] AS \[fk2\][\s\S]*\[AuditLog\]\.\[UpdatedById\]/.test(query) &&
      !/AS \[fk3\]/.test(query)
    )
  }).toBe(true)
})
