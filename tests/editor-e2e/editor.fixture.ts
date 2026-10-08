import { test as base, expect, Page } from '@playwright/test'

export const MOCK_ROOT = 'C:\\mock\\repo'
export const MOCK_FILE = 'C:\\mock\\repo\\notes.md'
export const MOCK_INITIAL_CONTENT = '# Notes\n\nhello\n'

export interface SavedWrite { path: string; content: string }

async function installElectronMock(page: Page) {
  await page.addInitScript(({ root, file, initial }) => {
    localStorage.clear()

    const state = { writes: [] as SavedWrite[] }
    ;(window as unknown as { __editorMock: typeof state }).__editorMock = state

    const unsub = () => () => {}
    const emptyAsync = async () => undefined

    const fs = {
      readDir: async (p: string) => {
        if (p.toLowerCase() === root.toLowerCase()) {
          return [
            { name: 'notes.md', isFile: true, isDirectory: false, size: initial.length },
            { name: 'src', isFile: false, isDirectory: true, size: 0 }
          ]
        }
        return []
      },
      readFile: async (p: string) => {
        if (p.toLowerCase() === file.toLowerCase()) return initial
        throw new Error(`ENOENT: ${p}`)
      },
      writeFile: async (p: string, content: string) => { state.writes.push({ path: p, content }) },
      listFiles: async () => [] as string[],
      delete: emptyAsync,
      mkdir: emptyAsync,
      watch: emptyAsync,
      unwatch: emptyAsync,
      onChanged: unsub
    }

    const git = {
      currentBranch: async () => 'main',
      gitCommonDir: async () => { throw new Error('not a git repo') },
      resolveRepoRoot: async (p: string) => p,
      status: async () => ({ current: 'main', files: [] }),
      stage: emptyAsync,
      unstage: emptyAsync,
      commit: emptyAsync,
      diffFile: async () => '',
      blame: async () => [],
      fileLog: async () => [],
      fetch: emptyAsync,
      pull: emptyAsync,
      push: emptyAsync
    }

    const electronAPI = {
      platform: 'win32',
      app: {
        initialTarget: async () => ({ path: file, isDirectory: false }),
        onOpenPath: unsub
      },
      updater: {
        install: async () => ({ ok: true }),
        state: async () => ({ packaged: false, currentVersion: '0.0.0', status: 'idle' }),
        check: async () => ({ packaged: false, currentVersion: '0.0.0', status: 'idle' }),
        onState: unsub,
        onDownloaded: unsub
      },
      fs,
      git,
      diff: { branch: async () => '' },
      roslyn: { ensure: async () => false },
      process: {
        start: async () => 'mock-process',
        stop: emptyAsync,
        onOutput: unsub,
        onExit: unsub
      },
      clipboard: { write: () => {} },
      shell: {
        openFolder: emptyAsync,
        openExternal: async () => true
      },
      dialog: {
        openFolder: async () => null,
        openFile: async () => null,
        saveFile: async () => null,
        saveSqlQuery: async () => null
      },
      ado: { connect: async () => true },
      sql: {},
      window: { minimize() {}, maximize() {}, close() {}, openDetached: async () => true },
      terminal: {},
      export: { xlsx: async () => null }
    }

    Object.defineProperty(window, 'electronAPI', { configurable: true, value: electronAPI })
  }, { root: MOCK_ROOT, file: MOCK_FILE, initial: MOCK_INITIAL_CONTENT })
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await installElectronMock(page)
    await page.goto('/#/panel/editor')
    await expect(page.getByTitle(MOCK_FILE)).toBeVisible()
    await use(page)
  }
})

export { expect }
