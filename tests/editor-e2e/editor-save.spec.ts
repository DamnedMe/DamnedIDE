import { test, expect, MOCK_FILE, MOCK_INITIAL_CONTENT } from './editor.fixture'
import type { Page } from '@playwright/test'

// Monaco is fetched from the CDN on first load: allow a cold cache + Vite
// dependency optimization before the editor becomes usable.
test.describe.configure({ timeout: 90_000 })

// A .md file opens in the rendered preview; both tests switch to the source
// editor (the way the user edits markdown) and change the document.
async function openMarkdownSourceForEdit(page: Page) {
  await page.getByTitle('show source').click()
  const editor = page.locator('.monaco-editor').first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nnew line from e2e\n')
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('new line from e2e')
}

const savedContents = (page: Page) =>
  page.evaluate(() => (window as unknown as { __editorMock: { writes: { path: string; content: string }[] } }).__editorMock.writes)

test('Ctrl+S saves the edited markdown file to disk', async ({ page }) => {
  await openMarkdownSourceForEdit(page)
  await page.keyboard.press('Control+s')
  await expect.poll(async () => {
    const writes = await savedContents(page)
    return writes.some(w => w.path === MOCK_FILE && w.content.includes('new line from e2e'))
  }).toBe(true)
})

// A file opened with a target line (from the OS, the Worktree view, Go to...) waits for the
// viewport before revealing that line. In a file shorter than 5 lines the wait never ended
// by itself: it pulled the cursor to line 1 as soon as the file reached 5 lines, so at human
// speed everything typed after the first Enter landed at the top of the file and was saved there.
test('typing at human speed in a short file stays where the cursor is', async ({ page }) => {
  await page.getByTitle('show source').click()
  const editor = page.locator('.monaco-editor').first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nnew line from e2e\n', { delay: 80 })
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await savedContents(page)).at(-1)?.content)
    .toBe(`${MOCK_INITIAL_CONTENT}\nnew line from e2e\n`)
})

test('the editor toolbar has a save button that saves the edited file', async ({ page }) => {
  await openMarkdownSourceForEdit(page)
  const saveButton = page.getByTitle('save (Ctrl+S)')
  await expect(saveButton).toBeVisible()
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect.poll(async () => {
    const writes = await savedContents(page)
    return writes.some(w => w.path === MOCK_FILE && w.content.includes('new line from e2e'))
  }).toBe(true)
})
