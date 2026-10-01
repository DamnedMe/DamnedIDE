import { test, expect } from './sql.fixture'

// The IDE text size / font settings apply to the whole application: the slider
// ranges are wide, Nunito is the default family, the previous font stays
// selectable and a custom family can be added.

test('appearance settings: global font family and size ranges', async ({ page }) => {
  await page.goto('/')
  await page.getByTitle('settings').click()

  // the font select is the one containing the default Nunito option
  const fontSelect = page.locator('select', { has: page.locator('option[value="Nunito"]') })
  await expect(fontSelect).toBeVisible()
  await expect(fontSelect).toHaveValue('Nunito')

  // the font previously used by the IDE remains among the choices
  await expect(fontSelect.locator('option[value="JetBrains Mono"]')).toHaveCount(1)

  // wider ranges: icon 10..30, IDE text 8..30
  await expect(page.locator('input[type="range"][min="10"][max="30"]')).toHaveCount(1)
  await expect(page.locator('input[type="range"][min="8"][max="30"]')).toHaveCount(1)

  // selecting a family drives the whole document
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Nunito')
  await fontSelect.selectOption('JetBrains Mono')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('JetBrains Mono')
  await fontSelect.selectOption('Nunito')

  // a custom family can be added, applied and removed
  const addInput = page.getByPlaceholder('font family')
  await addInput.fill('Georgia')
  await page.getByTitle('aggiungi e applica il font').click()
  await expect(fontSelect).toHaveValue('Georgia')
  await expect(fontSelect.locator('option[value="Georgia"]')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Georgia')
  await page.getByTitle('remove Georgia').click()
  await expect(fontSelect.locator('option[value="Georgia"]')).toHaveCount(0)
  await expect(fontSelect).toHaveValue('Nunito')
})
