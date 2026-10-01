import { test, expect, openMockTables } from './sql.fixture'

// Pinning a column must not hide the columns before it: the pinned columns form
// a left rail and the remaining columns take the space they leave free.

test('pinned columns leave the previous ones visible and clickable', async ({ page }) => {
  await openMockTables(page)
  await page.getByLabel('table dbo.MassiveRows').click({ button: 'right' })
  await page.getByText('select top 1000 rows', { exact: true }).click()
  await expect(page.getByText('250000 rows', { exact: true })).toBeVisible()

  const header = (name: string) => page.locator(`[role="columnheader"][aria-label="${name}"]`)

  // pin the second column: the first one must stay visible right after the rail
  await header('ParentId').getByLabel('pin ParentId').click()
  const parent = (await header('ParentId').boundingBox())!
  const id = (await header('Id').boundingBox())!
  expect(id.x).toBeGreaterThanOrEqual(parent.x + parent.width - 1)

  // its pin button is not covered by the rail, so it can be pinned too
  await header('Id').getByLabel('pin Id').click()
  const pinnedId = (await header('Id').boundingBox())!
  const pinnedParent = (await header('ParentId').boundingBox())!
  // the rail follows the result order: Id, then ParentId
  expect(pinnedId.x).toBeLessThanOrEqual(pinnedParent.x)
  expect(pinnedParent.x).toBeGreaterThanOrEqual(pinnedId.x + pinnedId.width - 1)
  await expect(header('Id').getByLabel('unpin Id')).toBeVisible()
  await expect(header('ParentId').getByLabel('unpin ParentId')).toBeVisible()

  // the data cells follow the same geometry as the headers
  const cell = (name: string) => page.locator(`[role="gridcell"][data-result-column="${name}"]`).first()
  const cellId = (await cell('Id').boundingBox())!
  const cellParent = (await cell('ParentId').boundingBox())!
  expect(cellParent.x).toBeGreaterThanOrEqual(cellId.x + cellId.width - 1)
})
