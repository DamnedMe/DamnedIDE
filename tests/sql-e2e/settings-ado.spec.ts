import type { Page } from '@playwright/test'
import { test, expect, seedAdo, adoCalls } from './sql.fixture'

// Azure DevOps in Settings: connections with a write-only PAT, the repository of
// the open folder (asked when it is not clear, then remembered) and the release
// BE/FE choices, all saved through the main-process adoSettings API (in memory
// in sql.fixture).

const REPO = 'C:/repos/Themis-API'
const FOLDER_KEY = 'c:/repos/themis-api'

const settingsNav = (page: Page) => page.getByRole('navigation', { name: 'settings pages' })
const navPage = (page: Page, label: string) => settingsNav(page).getByRole('button', { name: label, exact: true })

/** Opens REPO (a main checkout) from the startup dialog, on the given panel. */
async function openRepo(page: Page, panel: 'ado' | 'release') {
  await page.addInitScript(({ repo, panel }) => {
    localStorage.setItem('damnedide_recent_repos', JSON.stringify([repo]))
    localStorage.setItem('damnedide_last_panel', panel)
    ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI.git = {
      resolveRepoRoot: async (p: string) => p,
      gitCommonDir: async (p: string) => `${p}/.git`
    }
  }, { repo: REPO, panel })
  await page.goto('/')
  await page.getByText(REPO, { exact: true }).click()
}

// no ErrorBoundary in the app: an exception (e.g. a hook-order bug) blanks the window
const pageErrors: string[] = []
test.beforeEach(({ page }) => {
  pageErrors.length = 0
  page.on('pageerror', e => pageErrors.push(e.message))
})
test.afterEach(() => {
  expect(pageErrors, 'uncaught page errors').toEqual([])
})

test('settings: grouped navigation, search and the remembered page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('damnedide_settings_page', 'terminal'))
  await page.goto('/')
  await page.getByTitle('settings', { exact: true }).click()

  // the last page is shown again
  await expect(navPage(page, 'Terminal')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('input[type="range"][min="8"][max="32"]')).toHaveCount(1)

  // Azure DevOps is a group with its three pages
  await expect(settingsNav(page).getByRole('group', { name: 'Azure DevOps' }).getByRole('button'))
    .toHaveText(['Connections', 'Repositories by folder', 'Release'])
  await navPage(page, 'Release').click()
  await expect(navPage(page, 'Release')).toHaveAttribute('aria-current', 'page')
  await expect(navPage(page, 'Terminal')).not.toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('no Azure DevOps connection configured')).toBeVisible()

  // search: every word must start a word of the page (pat -> Connections, not « mappatura »)
  const search = page.getByPlaceholder('search settings')
  await search.fill('pat')
  await expect(settingsNav(page).getByRole('button')).toHaveText(['Connections'])
  await search.press('Enter')
  await expect(navPage(page, 'Connections')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByPlaceholder('paste the PAT')).toBeVisible()

  await search.fill('font')
  await expect(navPage(page, 'Text and icons')).toBeVisible()
  await search.fill('zzzz')
  await expect(settingsNav(page)).toContainText('no page for «zzzz»')
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(settingsNav(page).getByRole('button')).toHaveCount(14)

  expect(await page.evaluate(() => localStorage.getItem('damnedide_settings_page'))).toBe('ado-connections')
})

test('settings: adding a connection verifies it, keeps the PAT write-only and clears it after saving', async ({ page }) => {
  // the new connection's project has a repository named like the open folder
  await seedAdo(page, { newRepos: ['Themis-API', 'Themis-Frontend'] })
  await openRepo(page, 'ado')

  // nothing configured: the DevOps panel says so and opens Settings › Azure DevOps › Connessioni
  await expect(page.getByText('no Azure DevOps connection configured')).toBeVisible()
  await page.getByRole('button', { name: 'configure in Settings' }).click()
  await expect(navPage(page, 'Connections')).toHaveAttribute('aria-current', 'page')

  // with no connection the add form is the page
  const org = page.getByPlaceholder('contoso', { exact: true })
  const project = page.getByPlaceholder('Themis', { exact: true })
  const pat = page.getByPlaceholder('paste the PAT', { exact: true })
  const save = page.getByRole('button', { name: 'verify and save' })
  await expect(pat).toHaveAttribute('type', 'password')
  await expect(save).toBeDisabled()

  // Azure DevOps refuses: the mapped error shows inline (no IPC prefix) and nothing is saved
  await org.fill('bad')
  await project.fill('Shop')
  await pat.fill('wrong-pat')
  await save.click()
  await expect(page.getByText('PAT non valido, scaduto o senza permesso Code (Read)')).toBeVisible()
  await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __adoMock: { settings: { connections: unknown[] } } }).__adoMock.settings.connections)).toEqual([])

  // a project URL pasted into Organization fills both fields
  await org.fill('https://dev.azure.com/contoso/Themis/_git/Themis-API')
  await expect(org).toHaveValue('contoso')
  await expect(project).toHaveValue('Themis')
  await pat.fill('secret-pat')
  await save.click()

  await expect(page.getByText('PAT saved', { exact: true })).toBeVisible()
  await expect(page.getByText('2 repositories').first()).toBeVisible()
  expect(await adoCalls(page, 'saveConnection')).toEqual([
    [{ organization: 'bad', project: 'Shop', token: 'wrong-pat' }],
    [{ organization: 'contoso', project: 'Themis', token: 'secret-pat' }]
  ])

  // the PAT never comes back: the form is gone, a new one starts empty, an edit only says it is saved
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  expect(await page.content()).not.toContain('secret-pat')
  await page.getByRole('button', { name: 'add connection' }).click()
  await expect(pat).toHaveValue('')
  await page.getByRole('button', { name: 'cancel', exact: true }).click()
  await page.getByRole('button', { name: 'edit', exact: true }).click()
  const edit = page.getByPlaceholder('PAT saved — paste to replace it')
  await expect(edit).toHaveAttribute('type', 'password')
  await expect(edit).toHaveValue('')
  await page.getByRole('button', { name: 'cancel', exact: true }).click()

  // back to DevOps: the only repository named like the folder is used and remembered
  await page.getByTitle('settings', { exact: true }).click()
  await expect.poll(() => adoCalls(page, 'setFolder')).toEqual([[FOLDER_KEY, { connectionId: 'c1', repository: 'Themis-API' }]])
  await expect(page.getByTitle('Azure DevOps settings')).toBeVisible()
  await expect.poll(() => adoCalls(page, 'pullRequests')).toContainEqual(['Themis', 'Themis-API'])
})

test('DevOps panel: two connections with a repository named like the folder ask which one to use', async ({ page }) => {
  await seedAdo(page, {
    connections: [{ id: 'c1', organization: 'org1', project: 'p1' }, { id: 'c2', organization: 'org2', project: 'p2' }],
    tokens: { c1: true, c2: true },
    catalog: {
      c1: { ok: true, repos: ['Themis-API', 'Themis-Frontend'] },
      c2: { ok: true, repos: ['Other', 'themis-api'] }
    }
  })
  await openRepo(page, 'ado')

  await expect(page.getByText('several Azure DevOps repositories are named «Themis-API»: choose the one to use for this folder')).toBeVisible()
  const select = page.getByLabel('Azure DevOps repository')
  await expect(select.locator('optgroup')).toHaveCount(2)
  await expect(select.locator('optgroup[label="org1 / p1"] option')).toHaveText(['Themis-API'])
  await expect(select.locator('optgroup[label="org2 / p2"] option')).toHaveText(['themis-api'])
  const remember = page.getByRole('button', { name: 'use and remember' })
  await expect(remember).toBeDisabled()
  // nothing is used or saved before the choice
  expect(await adoCalls(page, 'setFolder')).toEqual([])
  expect(await adoCalls(page, 'use')).toEqual([])

  await select.selectOption({ value: 'c2\nthemis-api' })
  await expect(remember).toBeEnabled()
  await remember.click()

  await expect.poll(() => adoCalls(page, 'setFolder')).toEqual([[FOLDER_KEY, { connectionId: 'c2', repository: 'themis-api' }]])
  // ready: the panel works on the chosen connection and repository
  await expect(page.getByTitle('Azure DevOps settings')).toBeVisible()
  await expect(page.getByLabel('Azure DevOps repository')).toHaveCount(0)
  await expect.poll(() => adoCalls(page, 'pullRequests')).toContainEqual(['p2', 'themis-api'])
  expect((await adoCalls(page, 'use')).map(([id]) => id)).toContain('c2')
  expect((await adoCalls(page, 'use')).every(([id]) => id === 'c2')).toBe(true)
  expect((await adoCalls(page, 'workItems')).every(([p]) => p === 'p2')).toBe(true)

  // the chooser's choice shows in Settings › Azure DevOps › Repository per cartella
  await page.getByTitle('Azure DevOps settings').click()
  await expect(navPage(page, 'Connections')).toHaveAttribute('aria-current', 'page')
  await navPage(page, 'Repositories by folder').click()
  await expect(page.getByText(REPO).first()).toBeVisible()
})

test('Release panel: BE and FE dropdowns save the choice through setRelease', async ({ page }) => {
  await seedAdo(page, {
    connections: [{ id: 'c1', organization: 'Org1', project: 'P1' }],
    tokens: { c1: true },
    folders: {
      [FOLDER_KEY]: { connectionId: 'c1', repository: 'Themis-API' },
      'c:/repos/themis-frontend': { connectionId: 'c1', repository: 'Themis-Frontend' }
    },
    release: { 'org1/p1': { branches: { 'Themis-API': { qa: 'qa' } } } },
    catalog: { c1: { ok: true, repos: ['Other', 'Themis-API', 'Themis-Frontend'] } }
  })
  await openRepo(page, 'release')

  const be = page.getByLabel('BE repository')
  const fe = page.getByLabel('FE repository')
  // defaults: BE = the folder's repository, FE = the repository of another folder of the project
  await expect(be).toHaveValue('Themis-API')
  await expect(be.locator('option:checked')).toHaveText('Themis-API (this folder)')
  await expect(fe).toHaveValue('Themis-Frontend')
  // FE never offers the BE
  await expect(fe.locator('option')).toHaveText(['—', 'Other', 'Themis-Frontend'])
  await expect(page.getByText('saved in')).toBeVisible()

  await be.selectOption('Other')
  await expect.poll(() => adoCalls(page, 'setRelease'))
    .toEqual([['org1/p1', { branches: { 'Themis-API': { qa: 'qa' } }, beRepo: 'Other' }]])
  await expect(be).toHaveValue('Other')
  await expect(fe.locator('option')).toHaveText(['—', 'Themis-API', 'Themis-Frontend'])

  await fe.selectOption('Themis-API')
  await expect.poll(async () => (await adoCalls(page, 'setRelease'))[1])
    .toEqual(['org1/p1', { branches: { 'Themis-API': { qa: 'qa' } }, beRepo: 'Other', feRepo: 'Themis-API' }])
  await expect(fe).toHaveValue('Themis-API')

  // every call went to the folder's connection, the new BE is previewed
  expect((await adoCalls(page, 'use')).every(([id]) => id === 'c1')).toBe(true)
  await expect.poll(() => adoCalls(page, 'branches')).toContainEqual(['P1', 'Other'])

  // the same choice is in Settings › Azure DevOps › Rilascio
  await page.getByRole('button', { name: 'Settings › Azure DevOps › Release' }).click()
  await expect(navPage(page, 'Release')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTitle('backend repository')).toHaveValue('Other')
  await expect(page.getByTitle('frontend repository')).toHaveValue('Themis-API')
})

test('startup: the old localStorage Azure DevOps configuration moves to the main process', async ({ page }) => {
  const legacy = { [FOLDER_KEY]: { organization: 'org1', project: 'p1', repository: 'Themis-API', token: 'legacy-pat', isConnected: true } }
  const promotion = { 'org1/p1': { feRepo: 'Themis-Frontend' } }
  await page.addInitScript(({ legacy, promotion }) => {
    localStorage.setItem('damnedide_ado_connections', JSON.stringify(legacy))
    localStorage.setItem('damnedide_ado_promotion', JSON.stringify(promotion))
  }, { legacy, promotion })
  await page.goto('/')

  await expect.poll(() => adoCalls(page, 'importLegacy')).toEqual([[legacy, promotion]])
  // the plaintext PATs leave localStorage (and so the shared renderer-storage.json)
  await expect.poll(() => page.evaluate(() =>
    ['damnedide_ado_connections', 'damnedide_ado_connection', 'damnedide_ado_promotion'].map(k => localStorage.getItem(k))
  )).toEqual([null, null, null])
})
