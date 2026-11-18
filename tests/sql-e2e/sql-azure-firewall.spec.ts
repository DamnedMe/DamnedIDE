import { test, expect } from './sql.fixture'
import type { Page } from '@playwright/test'

const SERVER = 'prod-azure-sql-dbserver.database.windows.net'
const LABEL = `${SERVER}/devops`

// The connection points at Azure SQL, whose firewall refuses this IP (error 40615, in Italian as
// the server sends it) until azureFirewallAllow is called; the mock rule is live at once.
async function blockedAzureServer(page: Page) {
  await page.addInitScript(({ server, label }) => {
    localStorage.setItem('damnedide_sql_connections', JSON.stringify([{
      id: 'azure-conn', server, database: 'devops', user: 'dev', password: 'x', authType: 'sql', isConnected: false, label
    }]))
    const state = { allowed: false, allowCalls: [] as unknown[][], connects: 0 }
    ;(window as unknown as { __fw: typeof state }).__fw = state
    const error = () => new Error("Error invoking remote method 'sql:connect': Error: Impossibile aprire il server 'prod-azure-sql-dbserver' richiesto dal login. Il client con indirizzo IP '78.210.67.42' non può accedere al server. Per abilitare l'accesso, utilizza il Portale di Gestione Azure o esegui sp_set_firewall_rule sul database master per creare una regola firewall per questo indirizzo IP o intervallo di indirizzi.")
    const sql = (window as unknown as { electronAPI: { sql: Record<string, unknown> } }).electronAPI.sql
    sql.connect = async (config: { connectionId?: string }) => {
      state.connects++
      if (!state.allowed) throw error()
      return config.connectionId
    }
    sql.testConnection = async () => state.allowed ? { ok: true, version: 'Azure SQL' } : { ok: false, error: error().message }
    sql.azureFirewallAllow = async (...args: unknown[]) => {
      state.allowCalls.push(args)
      await new Promise(resolve => setTimeout(resolve, 150))
      state.allowed = true
      return {
        ruleName: 'DamnedIDE_PC', serverName: 'prod-azure-sql-dbserver', subscriptionId: 's', resourceGroup: 'rg',
        portalUrl: 'https://portal.azure.com/#resource/x/networking', via: 'browser'
      }
    }
    sql.azureFirewallCancel = async () => undefined
  }, { server: SERVER, label: LABEL })
  await page.reload()
  await expect(page.getByText('SQL Server', { exact: true })).toBeVisible()
}

const fw = (page: Page) => page.evaluate(() => (window as unknown as { __fw: { allowed: boolean; allowCalls: unknown[][]; connects: number } }).__fw)

test('a connection refused by the Azure SQL firewall offers to authorize the IP, then connects', async ({ page }) => {
  await blockedAzureServer(page)
  await page.getByLabel(`connection ${LABEL}`, { exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'Azure SQL firewall' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('78.210.67.42')

  await dialog.getByRole('button', { name: 'authorize IP' }).click()
  await expect(dialog).toBeHidden()
  expect((await fw(page)).allowCalls).toEqual([[SERVER, '78.210.67.42']])
  await expect(page.getByLabel(`expand connection ${LABEL}`)).toBeVisible()
})

test('the connection menu authorizes the IP on demand', async ({ page }) => {
  await blockedAzureServer(page)
  await page.getByLabel(`connection ${LABEL}`, { exact: true }).click({ button: 'right' })
  await page.getByText('authorize my IP on the Azure firewall…', { exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'Azure SQL firewall' })
  await expect(dialog).toContainText('78.210.67.42')
  await dialog.getByRole('button', { name: 'authorize IP' }).click()
  await expect(dialog).toBeHidden()
  expect((await fw(page)).allowed).toBe(true)
})

test('the menu entry is only offered for Azure SQL servers', async ({ page }) => {
  await page.getByLabel('connection mock-sql-server/massive_mock_db', { exact: true }).click({ button: 'right' })
  await expect(page.getByText('server info', { exact: true }).or(page.getByText('remove', { exact: true })).first()).toBeVisible()
  await expect(page.getByText('authorize my IP on the Azure firewall…', { exact: true })).toHaveCount(0)
})
