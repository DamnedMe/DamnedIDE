import type { Page } from '@playwright/test'
import { test, expect, seedAdo, adoCalls, openAdoRepo } from './sql.fixture'
import type { AdoMockSeed } from './sql.fixture'

// Release chain develop → qa → prod: the Release panel's third stage asks ONE
// confirmation, creates the develop → qa PRs and hands them to main
// (adoChain.start, in memory in sql.fixture), which creates each qa → prod PR
// once its develop → qa PR is completed; the project's chains are listed below.

const REPO = 'C:/repos/Themis-API'
const FOLDER_KEY = 'c:/repos/themis-api'
const branches = { dev: 'develop', qa: 'qa', prod: 'main' }

const base: AdoMockSeed = {
  connections: [{ id: 'c1', organization: 'Org1', project: 'P1' }],
  tokens: { c1: true },
  folders: {
    [FOLDER_KEY]: { connectionId: 'c1', repository: 'Themis-API' },
    'c:/repos/themis-frontend': { connectionId: 'c1', repository: 'Themis-Frontend' }
  },
  catalog: { c1: { ok: true, repos: ['Other', 'Themis-API', 'Themis-Frontend'] } }
}

const settingsNav = (page: Page) => page.getByRole('navigation', { name: 'pagine delle impostazioni' })
const stageButton = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true })

// no ErrorBoundary in the app: an exception (e.g. a hook-order bug) blanks the window
const pageErrors: string[] = []
test.beforeEach(({ page }) => {
  pageErrors.length = 0
  page.on('pageerror', e => pageErrors.push(e.message))
})
test.afterEach(() => {
  expect(pageErrors, 'uncaught page errors').toEqual([])
})

test('Release panel: develop → qa → prod asks one confirmation, creates develop → qa and starts the chain', async ({ page }) => {
  await seedAdo(page, {
    ...base,
    commits: {
      'Themis-API:develop->qa': [
        { commitId: 'a1b2c3d4e5', message: 'Merged PR 12: #5444 login', author: 'Dev' },
        { commitId: 'f6a7b8c9d0', message: 'fix layout', author: 'Dev' }
      ],
      // the FE has nothing for qa but commits for prod: its chain starts at qa → prod
      'Themis-Frontend:qa->main': [{ commitId: 'e1e2e3e4e5', message: 'Merged PR 13: #5445 menu', author: 'Dev' }]
    },
    workItems: [{ id: 5444, title: 'Login', type: 'Bug', state: 'Done', assignedTo: '', url: '' }]
  })
  await openAdoRepo(page, REPO, 'release')

  await expect(stageButton(page, 'develop → qa')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'BE+FE', exact: true }).click()
  // the third stage is remembered for the project, through the same setRelease as BE/FE
  await stageButton(page, 'develop → qa → prod').click()
  await expect.poll(() => adoCalls(page, 'setRelease')).toEqual([['org1/p1', { stage: 'dev-qa-prod' }]])
  await expect(stageButton(page, 'develop → qa → prod')).toHaveAttribute('aria-pressed', 'true')

  // both cards resolve prod too, the FE says where its chain starts
  await expect(page.getByTitle('prod branch')).toHaveCount(2)
  await expect(page.getByTitle('prod branch').first()).toHaveValue('main')
  await expect(page.getByText('develop → qa: nulla da promuovere, la catena parte da qa → main (1 commit)')).toBeVisible()

  await page.getByRole('checkbox', { name: 'auto-complete when policies pass' }).check()
  await page.getByRole('button', { name: 'avvia catena (2)' }).click()

  // ONE confirmation, covering the qa → prod step too
  const dialog = page.getByRole('dialog', { name: 'conferma catena di rilascio develop → qa → prod' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Questa conferma vale anche per la produzione')
  await expect(dialog).toContainText('BE · Themis-API')
  await expect(dialog).toContainText('1. develop → qa: nuova PR · 2 commit · 1 work item')
  await expect(dialog).toContainText('2. qa → main: PR creata appena la PR develop → qa è completata')
  await expect(dialog).toContainText('FE · Themis-Frontend')
  await expect(dialog).toContainText('1. develop → qa: nulla da promuovere, si parte dal passo 2')
  await expect(dialog).toContainText('2. qa → main: PR creata subito · 1 commit')
  await expect(dialog).toContainText('2. qa → main: PR creata appena la PR develop → qa è completata · con tutti i work item dei suoi commit')
  await expect(dialog).toContainText('Auto-complete armato sulle PR create dalla catena')
  expect(await adoCalls(page, 'createPr'), 'nothing is created before the confirmation').toEqual([])
  await dialog.getByRole('button', { name: 'avvia catena' }).click()
  await expect(dialog).toHaveCount(0)

  // step 1: only the BE needed a develop → qa PR (auto-complete, never a bypass, develop kept)
  await expect.poll(() => adoCalls(page, 'chainStart')).toHaveLength(1)
  const created = await adoCalls(page, 'createPr')
  expect(created).toHaveLength(1)
  expect(created[0][0]).toBe('P1')
  expect(created[0][1]).toBe('Themis-API')
  expect(created[0][2]).toMatchObject({
    sourceRef: 'develop', targetRef: 'qa', autoComplete: true, workItemIds: [5444],
    deleteSourceBranch: false, forceComplete: false
  })
  expect(String((created[0][2] as { title: string }).title)).toMatch(/^Release develop → qa · BE · \d{4}-\d{2}-\d{2}$/)
  // then main gets both items: BE waits for PR #501, FE starts at qa → prod
  expect(await adoCalls(page, 'chainStart')).toEqual([[{
    connectionId: 'c1',
    autoComplete: true,
    items: [
      { side: 'BE', repo: 'Themis-API', branches, qaPr: { id: 501, url: 'https://dev.azure.com/mock/P1/_git/Themis-API/pullrequest/501' } },
      { side: 'FE', repo: 'Themis-Frontend', branches }
    ]
  }]])
  await expect(page.getByText('catena di rilascio avviata: BE Themis-API, FE Themis-Frontend')).toBeVisible()

  // the chain is listed with both steps
  const chains = page.getByRole('region', { name: 'catene in corso' })
  const chain = chains.getByRole('group', { name: 'catena Themis-API, Themis-Frontend' })
  await expect(chain).toBeVisible()
  await expect(chain.getByRole('button', { name: 'PR #501 ↗' })).toBeVisible()
  await expect(chain).toContainText('partirà quando la PR develop → qa è completata')
  await expect(chain).toContainText('creazione in corso…')
  await expect(chain.getByRole('button', { name: 'annulla catena' })).toBeVisible()
  // both repositories are now in a running chain: nothing more to start
  await expect(page.getByRole('button', { name: 'avvia catena (0)' })).toBeDisabled()
  await expect(page.getByText('catena di rilascio già in corso per Themis-Frontend', { exact: false })).toBeVisible()
})

test('Release panel: the remembered chain stage follows an active develop → qa PR; chains can be cancelled and removed', async ({ page }) => {
  const t = Date.UTC(2026, 10, 5, 9, 30)
  await seedAdo(page, {
    ...base,
    release: { 'org1/p1': { stage: 'dev-qa-prod' } },
    commits: { 'Themis-API:develop->qa': [{ commitId: 'a1b2c3d4e5', message: 'fix', author: 'Dev' }] },
    pullRequests: {
      'Themis-API': [{
        id: 77, title: 'Release', status: 'active', sourceBranch: 'develop', targetBranch: 'qa', createdBy: 'Dev',
        isDraft: false, needsApproval: false, myVote: 0, reviewers: [], url: 'https://dev.azure.com/mock/P1/_git/Themis-API/pullrequest/77'
      }]
    },
    chains: [
      {
        id: 'old', connectionId: 'c1', organization: 'Org1', project: 'P1', autoComplete: false, createdAt: t,
        items: [{ side: 'FE', repo: 'Themis-Frontend', branches, qaPr: { id: 600, url: '' }, prodPr: { id: 900, url: '' }, status: 'done', updatedAt: t }]
      },
      {
        id: 'running', connectionId: 'c1', organization: 'Org1', project: 'P1', autoComplete: true, createdAt: t + 60_000,
        items: [{ side: 'BE', repo: 'Other', branches, qaPr: { id: 610, url: '' }, status: 'waiting-qa', lastError: 'Azure DevOps non raggiungibile: offline', updatedAt: t }]
      },
      {
        id: 'broken', connectionId: 'c1', organization: 'Org1', project: 'P1', autoComplete: false, createdAt: t - 60_000,
        items: [{ side: 'BE', repo: 'Legacy', branches, qaPr: { id: 620, url: '' }, status: 'failed', error: 'PR develop → qa abbandonata', updatedAt: t }]
      },
      // another project's chain is not shown here
      {
        id: 'elsewhere', connectionId: 'c9', organization: 'Org9', project: 'P9', autoComplete: false, createdAt: t,
        items: [{ side: 'BE', repo: 'Far', branches, qaPr: { id: 1, url: '' }, status: 'waiting-qa', updatedAt: t }]
      }
    ]
  })
  await openAdoRepo(page, REPO, 'release')

  // the stage saved for the project is the one the panel opens on
  await expect(stageButton(page, 'develop → qa → prod')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'PR #77 già attiva ↗' })).toBeVisible()

  // the chain list: newest first, only this project
  const chains = page.getByRole('region', { name: 'catene in corso' })
  await expect(chains.getByRole('group')).toHaveCount(3)
  await expect(chains.getByRole('group').first()).toHaveAccessibleName('catena Other')
  const running = chains.getByRole('group', { name: 'catena Other' })
  await expect(running).toContainText('in attesa di qa')
  await expect(running).toContainText('in attesa del completamento')
  await expect(running).toContainText('ultimo controllo non riuscito: Azure DevOps non raggiungibile: offline · nuovo tentativo ogni 30 s')
  const done = chains.getByRole('group', { name: 'catena Themis-Frontend' })
  await expect(done.getByRole('button', { name: 'PR #600 ↗' })).toBeVisible()
  await expect(done.getByRole('button', { name: 'PR #900 ↗' })).toBeVisible()
  await expect(done).toContainText('completata')
  await expect(done.getByRole('button', { name: 'annulla catena' })).toHaveCount(0)
  const broken = chains.getByRole('group', { name: 'catena Legacy' })
  await expect(broken).toContainText('interrotta')
  await expect(broken).toContainText('PR develop → qa abbandonata')
  await expect(chains).not.toContainText('Far')

  // the active develop → qa PR is followed: no new PR, one confirmation
  await page.getByRole('button', { name: 'avvia catena (1)' }).click()
  const dialog = page.getByRole('dialog', { name: 'conferma catena di rilascio develop → qa → prod' })
  await expect(dialog).toContainText('1. develop → qa: PR #77 già attiva, la catena la segue (auto-complete non modificato)')
  await expect(dialog).toContainText('Le PR restano aperte')
  await dialog.getByRole('button', { name: 'avvia catena' }).click()
  await expect.poll(() => adoCalls(page, 'chainStart')).toEqual([[{
    connectionId: 'c1',
    autoComplete: false,
    items: [{ side: 'BE', repo: 'Themis-API', branches, qaPr: { id: 77, url: 'https://dev.azure.com/mock/P1/_git/Themis-API/pullrequest/77' } }]
  }]])
  expect(await adoCalls(page, 'createPr')).toEqual([])
  await expect(chains.getByRole('group')).toHaveCount(4)

  // cancel the running chain, then remove it and the finished one
  await running.getByRole('button', { name: 'annulla catena' }).click()
  await expect.poll(() => adoCalls(page, 'chainCancel')).toEqual([['running']])
  await expect(running).toContainText('annullata')
  await expect(running).toContainText('non creata: catena annullata')
  await running.getByRole('button', { name: 'rimuovi' }).click()
  await done.getByRole('button', { name: 'rimuovi' }).click()
  await expect.poll(() => adoCalls(page, 'chainRemove')).toEqual([['running'], ['old']])
  await expect(chains.getByRole('group')).toHaveCount(2)

  // the default stage is in Settings › Azure DevOps › Rilascio too
  await page.getByRole('button', { name: 'Impostazioni › Azure DevOps › Rilascio' }).click()
  await expect(settingsNav(page).getByRole('button', { name: 'Rilascio', exact: true })).toHaveAttribute('aria-current', 'page')
  const stage = page.getByTitle('fase di rilascio predefinita')
  await expect(stage).toHaveValue('dev-qa-prod')
  await expect(stage.locator('option')).toHaveText(['develop → qa', 'qa → prod', 'develop → qa → prod'])
  await stage.selectOption('qa-prod')
  await expect.poll(() => adoCalls(page, 'setRelease')).toEqual([['org1/p1', { stage: 'qa-prod' }]])
})

test('Release panel: in the chain stage a failed develop → qa read is an error, never "nothing to promote"', async ({ page }) => {
  // a lenient read would turn the 503 into "no commit" and start the chain at qa → prod
  await seedAdo(page, {
    ...base,
    release: { 'org1/p1': { stage: 'dev-qa-prod' } },
    commitErrors: { 'Themis-API:develop->qa': 'errore Azure DevOps 503' },
    commits: { 'Themis-API:qa->main': [{ commitId: 'e1e2e3e4e5', message: 'fix', author: 'Dev' }] }
  })
  await openAdoRepo(page, REPO, 'release')

  await expect(stageButton(page, 'develop → qa → prod')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('errore Azure DevOps 503', { exact: true })).toBeVisible()
  await expect(page.getByText('nulla da promuovere', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'avvia catena (0)' })).toBeDisabled()
})
