import { expect, openMockDatabase, openMockTables, test } from './sql.fixture'

test('SQL workbench keeps a clear hierarchy with a large result set', async ({ page }, testInfo) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible({ timeout: 10_000 })

  const activeContext = page.locator('.sql-active-context')
  await expect(activeContext).toContainText('mock-sql-server')
  await expect(activeContext).toContainText('massive_mock_db')
  await expect(page.locator('.sql-active-db-label')).toHaveText('active')
  const lightAnimation = await page.locator('.sql-status-light--explorer').first().evaluate(element =>
    getComputedStyle(element, '::after').animationName
  )
  expect(lightAnimation).toBe('sqlStatusPulse')

  const explorer = page.getByRole('complementary', { name: 'Object explorer' })
  const editor = page.getByLabel('Query editor')
  const output = page.getByLabel('SQL query output')
  const [explorerBox, editorBox, outputBox] = await Promise.all([
    explorer.boundingBox(), editor.boundingBox(), output.boundingBox()
  ])

  expect(explorerBox?.width || 0).toBeGreaterThanOrEqual(190)
  expect(editorBox?.height || 0).toBeGreaterThanOrEqual(140)
  expect(outputBox?.height || 0).toBeGreaterThanOrEqual(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth)
  )

  const screenshotPath = testInfo.outputPath('sql-workbench-results.png')
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('sql-workbench-results.png', { contentType: 'image/png', path: screenshotPath })
})

test('SQL controls inherit the application accent color', async ({ page }) => {
  await openMockDatabase(page)
  const customAccent = '#d86f45'
  await page.evaluate(accent => {
    const root = document.documentElement
    root.style.setProperty('--accent-color', accent)
    root.style.setProperty('--accent-bg', 'rgba(216, 111, 69, 0.13)')
    root.style.setProperty('--bg-active', 'rgba(216, 111, 69, 0.08)')
    root.style.setProperty('--bg-hover', 'rgba(216, 111, 69, 0.06)')
  }, customAccent)

  const runButton = page.getByRole('button', { name: 'Run', exact: true })
  await expect(runButton).toHaveCSS('background-color', 'rgb(216, 111, 69)')
  await expect(page.locator('.sql-page-title__icon')).toHaveCSS('color', 'rgb(216, 111, 69)')
})

test('workspace drawer is readable without covering its own navigation', async ({ page }, testInfo) => {
  await page.getByLabel('open SQL workspace').click()
  const drawer = page.getByRole('complementary', { name: 'SQL workspace' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('navigation', { name: 'SQL workspace sections' })).toBeVisible()
  await drawer.getByRole('button', { name: 'workspace', exact: true }).click()
  await expect(drawer.getByLabel('add query to workspace')).toBeVisible()

  const box = await drawer.boundingBox()
  expect(box?.width || 0).toBeGreaterThanOrEqual(360)
  expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))

  const screenshotPath = testInfo.outputPath('sql-workspace-drawer.png')
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('sql-workspace-drawer.png', { contentType: 'image/png', path: screenshotPath })
})

test('SQL workbench surface hierarchy remains legible in the application light theme', async ({ page }) => {
  await openMockTables(page)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light')

  const colors = await page.locator('.sql-workbench__shell').evaluate(element => {
    const shell = getComputedStyle(element)
    const card = getComputedStyle(document.querySelector('.sql-query-editor')!)
    return { shell: shell.backgroundColor, card: card.backgroundColor, text: card.color }
  })
  expect(colors.shell).not.toBe(colors.card)
  expect(colors.text).not.toBe(colors.card)
})
