import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/sql-e2e',
  outputDir: './test-results/sql-playwright',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['./tests/sql-e2e/sql-performance-reporter.ts'],
    ['html', { outputFolder: 'playwright-report/sql', open: 'never' }]
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1440, height: 900 }
  },
  projects: [
    { name: 'sql-chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'npm run dev:sql-e2e',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000
  }
})
