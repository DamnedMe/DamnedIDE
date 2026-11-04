import type { Locator, Page } from '@playwright/test'
import { test, expect, openMockTables } from './sql.fixture'

// Ctrl+wheel zooms one SQL workbench section at a time (object explorer, query
// editor, query output), Ctrl+0 resets it and the level is kept in localStorage.

const fontPx = (locator: Locator) => locator.evaluate(element => parseFloat(getComputedStyle(element).fontSize))
const ctrlWheel = (locator: Locator, deltaY: number) => locator.dispatchEvent('wheel', { deltaY, ctrlKey: true })
const editorText = (page: Page) => page.locator('.sql-query-editor .monaco-editor .view-lines').first()
const explorerRow = (page: Page) => page.getByLabel('connection mock-sql-server/massive_mock_db', { exact: true })

test('Ctrl+wheel on the query editor zooms only the editor section', async ({ page }) => {
  const editor = editorText(page)
  const editorTab = page.getByTitle('Query 1', { exact: true })
  const row = explorerRow(page)
  const outputTab = page.getByRole('tab', { name: 'Results' })
  await expect(editor).toBeVisible()
  const before = { editor: await fontPx(editor), tab: await fontPx(editorTab), explorer: await fontPx(row), output: await fontPx(outputTab) }

  // dispatched on Monaco's own lines: the capture listener must win over Monaco's scroll
  await ctrlWheel(editor, -100)
  await expect.poll(() => fontPx(editor)).toBeGreaterThan(before.editor)
  expect(await fontPx(editorTab)).toBeGreaterThan(before.tab)
  expect(await fontPx(row)).toBe(before.explorer)
  expect(await fontPx(outputTab)).toBe(before.output)

  await ctrlWheel(editor, 100)
  await expect.poll(() => fontPx(editor)).toBe(before.editor)
})

test('Ctrl+wheel on the object explorer zooms only the explorer and cancels the page zoom', async ({ page }) => {
  const editor = editorText(page)
  const row = explorerRow(page)
  await expect(editor).toBeVisible()
  const before = { editor: await fontPx(editor), explorer: await fontPx(row) }

  // the listener is non-passive: preventDefault really cancels the browser zoom
  const prevented = await row.evaluate(element => !element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true })))
  expect(prevented).toBe(true)
  await expect.poll(() => fontPx(row)).toBeGreaterThan(before.explorer)
  expect(await fontPx(editor)).toBe(before.editor)

  // a plain wheel is left alone (scrolling)
  const plainPrevented = await row.evaluate(element => !element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })))
  expect(plainPrevented).toBe(false)
})

test('Ctrl+wheel on the query output zooms messages and results grid as one section', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.AuditLog').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  const zoom = page.getByTestId('result-grid-zoom-level')
  await expect(zoom).toBeVisible()
  const readZoom = async () => Number((await zoom.textContent())?.replace('%', '') || 0)
  expect(await readZoom()).toBe(100)
  const editor = editorText(page)
  const editorBefore = await fontPx(editor)

  await page.getByRole('tab', { name: /^Messages/ }).click()
  const messages = page.getByRole('tabpanel', { name: 'Messages' })
  await expect(messages).toBeVisible()
  const messagesBefore = await fontPx(messages)
  await ctrlWheel(messages, -100)
  await expect.poll(() => fontPx(messages)).toBeGreaterThan(messagesBefore)
  expect(await fontPx(editor)).toBe(editorBefore)

  // the grid shows the same output zoom, and its toolbar buttons drive it
  await page.getByRole('tab', { name: 'Results' }).click()
  await expect.poll(readZoom).toBe(110)
  await page.getByTitle('zoom out (Ctrl+-)').click()
  await expect.poll(readZoom).toBe(100)
})

test('Ctrl+0 resets the focused section zoom', async ({ page }) => {
  const editor = editorText(page)
  await expect(editor).toBeVisible()
  const initial = await fontPx(editor)
  await ctrlWheel(editor, -100)
  await ctrlWheel(editor, -100)
  await expect.poll(() => fontPx(editor)).toBeGreaterThan(initial)

  await editor.click()
  await page.keyboard.press('Control+0')
  await expect.poll(() => fontPx(editor)).toBe(initial)
})

test('section zoom survives leaving and reopening the SQL panel', async ({ page }) => {
  await page.goto('/')
  await page.getByTitle('sql', { exact: true }).click()
  const editor = editorText(page)
  await expect(editor).toBeVisible()
  const initial = await fontPx(editor)
  await ctrlWheel(editor, -100)
  await expect.poll(() => fontPx(editor)).toBeGreaterThan(initial)
  const zoomed = await fontPx(editor)

  await page.getByTitle('settings', { exact: true }).click()
  await expect(editor).toHaveCount(0)
  await page.getByTitle('sql', { exact: true }).click()
  await expect(editor).toBeVisible()
  await expect.poll(() => fontPx(editor)).toBe(zoomed)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('damnedide_sql_zoom') || '{}'))
  expect(saved).toEqual({ explorer: 1, editor: 1.1, output: 1 })
})

test('a saved section zoom is restored when the IDE starts', async ({ page }) => {
  // runs after the fixture's init script, which clears localStorage
  await page.addInitScript(() => localStorage.setItem('damnedide_sql_zoom', JSON.stringify({ explorer: 1, editor: 1.21, output: 1 })))
  await page.reload()
  const editor = editorText(page)
  await expect(editor).toBeVisible()
  // default IDE font size 20px at 121%
  expect(await fontPx(editor)).toBeCloseTo(24.2, 0)
})
