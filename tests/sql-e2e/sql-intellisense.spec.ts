import { test, expect, openMockDatabase } from './sql.fixture'

test('SQL IntelliSense suggests columns for the alias at the cursor', async ({ page }) => {
  await openMockDatabase(page)
  const editor = page.locator('.monaco-editor')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText('FROM dbo.MassiveRows AS m')
  await page.keyboard.press('Home')
  await page.keyboard.insertText('SELECT m.')
  await page.keyboard.press('Control+Space')

  const suggestions = page.locator('.suggest-widget .monaco-list-row')
  await expect(suggestions.filter({ hasText: 'ParentId' }).first()).toBeVisible()
})

test('SQL IntelliSense stays above results and is not clipped by the editor pane', async ({ page }) => {
  await openMockDatabase(page)
  const editor = page.locator('.monaco-editor').first()
  await editor.click()
  await page.keyboard.insertText('SELECT m.\nFROM dbo.MassiveRows AS m')
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('End')
  await page.keyboard.press('Control+Space')

  const widget = page.locator('.suggest-widget').filter({ visible: true }).first()
  await expect(widget).toBeVisible()
  const geometry = await page.evaluate(() => {
    const editorElement = document.querySelector('.monaco-editor') as HTMLElement
    const widgetElement = [...document.querySelectorAll('.suggest-widget')].find(element => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }) as HTMLElement
    const editorBox = editorElement.getBoundingClientRect()
    const widgetBox = widgetElement.getBoundingClientRect()
    const sampleX = widgetBox.left + Math.min(20, widgetBox.width / 2)
    const sampleY = widgetBox.bottom - Math.min(10, widgetBox.height / 2)
    return {
      overflow: widgetBox.bottom - editorBox.bottom,
      topmost: document.elementFromPoint(sampleX, sampleY)?.closest('.suggest-widget') === widgetElement
    }
  })
  expect(geometry.overflow).toBeGreaterThan(5)
  expect(geometry.topmost).toBe(true)
})

test('SQL IntelliSense qualifies ambiguous columns and ranks columns from visible aliases', async ({ page }) => {
  await openMockDatabase(page)
  const editor = page.locator('.monaco-editor').first()
  await editor.click()
  await page.keyboard.insertText([
    'SELECT ',
    'FROM dbo.MassiveRows AS m',
    'JOIN dbo.Parent AS p ON p.Id = m.ParentId'
  ].join('\n'))
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('End')
  await page.keyboard.press('Control+Space')

  let suggestions = page.locator('.suggest-widget .monaco-list-row')
  await expect(suggestions.filter({ hasText: 'm.Code' }).first()).toBeVisible()

  await page.keyboard.press('Escape')
  await page.keyboard.insertText('p')
  await page.keyboard.press('Control+Space')
  suggestions = page.locator('.suggest-widget .monaco-list-row')
  await expect(suggestions.filter({ hasText: 'p.Name' }).first()).toBeVisible()

  await page.keyboard.press('Escape')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText('Id')
  await page.keyboard.press('Control+Space')
  suggestions = page.locator('.suggest-widget .monaco-list-row')
  await expect(suggestions.filter({ hasText: 'm.Id' }).first()).toBeVisible()
  await expect(suggestions.filter({ hasText: 'p.Id' }).first()).toBeVisible()
})

test('SQL IntelliSense offers SQL Server system procedure snippets', async ({ page }) => {
  await openMockDatabase(page)
  const editor = page.locator('.monaco-editor').first()
  await editor.click()
  await page.keyboard.insertText('sp_')
  await page.keyboard.press('Control+Space')
  const suggestions = page.locator('.suggest-widget .monaco-list-row')
  await expect(suggestions.filter({ hasText: 'sp_help' }).first()).toBeVisible()
  await expect(suggestions.filter({ hasText: 'sp_helptext' }).first()).toBeVisible()
  await expect(suggestions.filter({ hasText: 'sp_who2' }).first()).toBeVisible()
})
