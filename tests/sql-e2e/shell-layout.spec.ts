import { test, expect } from './sql.fixture'

// Layout C: the panels are tabs in the title bar (no left sidebar) and the
// repository switcher next to them suggests the recent repositories.

test('title bar: panel tabs switch panel and mark the active one', async ({ page }) => {
  await page.goto('/')
  const tabs = page.getByRole('navigation', { name: 'panels' }).getByRole('button')
  await expect(tabs).toHaveText(['Worktree', 'Editor', 'Git', 'DevOps', 'Release', 'SQL'])
  // no left sidebar anymore: the panel tabs are the only navigation on screen
  await expect(page.locator('nav')).toHaveCount(1)

  await page.getByTitle('sql', { exact: true }).click()
  await expect(page.getByTitle('sql', { exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTitle('worktree', { exact: true })).not.toHaveAttribute('aria-current', 'page')

  // the settings gear is not a tab: no tab is marked while settings are open
  await page.getByTitle('settings', { exact: true }).click()
  await expect(tabs.and(page.locator('[aria-current="page"]'))).toHaveCount(0)

  // at every icon and text size the bar stays one row and never clips the window controls
  const iconRange = page.locator('input[type="range"][min="10"][max="30"]')
  for (const size of [10, 20, 30]) {
    await iconRange.fill(String(size))
    const g = await page.evaluate(() => {
      const bar = document.querySelector('nav[aria-label="panels"]')!.parentElement!.getBoundingClientRect()
      const close = document.querySelector('button[title="close"]')!.getBoundingClientRect()
      return { barBottom: bar.bottom, barRight: bar.right, closeBottom: close.bottom, closeRight: close.right }
    })
    expect(g.closeBottom, `close button inside the bar at ${size}`).toBeLessThanOrEqual(g.barBottom + 0.5)
    expect(g.closeRight, `close button inside the bar at ${size}`).toBeLessThanOrEqual(g.barRight + 0.5)
  }
})

test('title bar: the repository switcher suggests the recent repositories', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('damnedide_recent_repos', JSON.stringify(['C:/repos/alpha', 'C:/repos/beta', 'C:/repos/gone']))
    // every folder fails to resolve: opening one prunes it from the recents
    ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI.git = { resolveRepoRoot: async () => null }
  })
  await page.goto('/')
  // the startup dialog proposes the same recents: skip it
  await page.locator('button', { hasText: /^skip$/ }).click()

  const repoBtn = page.locator('button[data-tip-desc^="switch to a recent repository"]')
  const menu = page.getByRole('menu', { name: 'recent repositories' })
  const rows = menu.getByRole('menuitem')

  await repoBtn.click()
  await expect(menu).toBeVisible()
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toContainText('alpha')
  await expect(rows.first()).toContainText('C:/repos/alpha')
  const box = (await menu.boundingBox())!
  const btn = (await repoBtn.boundingBox())!
  const vp = page.viewportSize()!
  expect(box.y, 'menu opens below the switcher').toBeGreaterThanOrEqual(btn.y + btn.height)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width)

  // Esc closes
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  // a folder that no longer resolves leaves the recents, with a toast
  await repoBtn.click()
  await rows.filter({ hasText: 'gone' }).click()
  await expect(menu).toHaveCount(0)
  await expect(page.getByText('rimosso dai recenti')).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('damnedide_recent_repos'))).toBe(JSON.stringify(['C:/repos/alpha', 'C:/repos/beta']))

  // per-row remove keeps the menu open
  await repoBtn.click()
  await rows.filter({ hasText: 'beta' }).getByRole('button').click()
  await expect(rows).toHaveCount(1)

  // clear empties the list in place (clearRepos updates the store)
  await menu.getByRole('button', { name: 'clear recents' }).click()
  await expect(rows).toHaveCount(0)
  await expect(menu).toContainText('no recent repositories')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('damnedide_recent_repos'))).toBe('[]')

  // browse closes the menu (the mocked native dialog returns nothing)
  await menu.getByRole('button', { name: /browse/ }).click()
  await expect(menu).toHaveCount(0)
})
