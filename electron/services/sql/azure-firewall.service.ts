import { hostname } from 'os'
import {
  AzureCliCredential,
  AzureDeveloperCliCredential,
  AzurePowerShellCredential,
  ChainedTokenCredential,
  InteractiveBrowserCredential,
  type TokenCredential
} from '@azure/identity'
import {
  azureSqlServerRef,
  findSqlServer,
  firewallRuleName,
  firewallRuleUrl,
  serverNetworkingPortalUrl,
  SQL_ARM_API_VERSION,
  type ArmSqlServer,
  type AzureSqlServerRef
} from '../../../src/shared/sqlAzureFirewall'

export interface AzureFirewallAllowResult {
  ruleName: string
  serverName: string
  subscriptionId: string
  resourceGroup: string
  portalUrl: string
  /** who signed in: the Azure CLI / PowerShell login, or the browser sign-in */
  via: 'cli' | 'browser'
}

interface ArmList<T> { value?: T[]; nextLink?: string }

/**
 * Adds an Azure SQL server-level firewall rule for this computer's public IP through Azure Resource
 * Manager, as SSMS does on error 40615. sp_set_firewall_rule cannot be used here: it runs on master,
 * which the same firewall blocks. The rule needs an Azure account with write access on the server
 * (SQL Server Contributor or Contributor): the one signed in to the Azure CLI / Azure PowerShell, or
 * else one the user signs in with in the browser (kept for the rest of the session).
 */
export class AzureFirewallService {
  private browser: InteractiveBrowserCredential | null = null
  private running: AbortController | null = null

  cancel(): void {
    this.running?.abort()
  }

  async allowIp(server: string, ip: string): Promise<AzureFirewallAllowResult> {
    const ref = azureSqlServerRef(server)
    if (!ref) throw new Error(`'${server}' non è un server Azure SQL (*.database.windows.net)`)
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error(`indirizzo IP non valido: ${ip}`)
    this.running?.abort()
    const abort = new AbortController()
    this.running = abort
    try {
      const scope = `https://${ref.cloud.armHost}/.default`
      // the developer's own CLI login first: no browser when `az login` / Connect-AzAccount was done
      const cli = new ChainedTokenCredential(
        new AzureCliCredential({ processTimeoutInMs: 15_000 }),
        new AzureDeveloperCliCredential({ processTimeoutInMs: 15_000 }),
        new AzurePowerShellCredential({ processTimeoutInMs: 20_000 })
      )
      let found = await this.tryLocate(cli, scope, ref, abort.signal)
      let credential: TokenCredential = cli
      let via: AzureFirewallAllowResult['via'] = 'cli'
      if (!found) {
        this.browser ??= new InteractiveBrowserCredential({
          tenantId: 'organizations',
          additionallyAllowedTenants: ['*'],
          authorityHost: ref.cloud.armHost === 'management.azure.com' ? undefined
            : ref.cloud.armHost === 'management.chinacloudapi.cn' ? 'https://login.chinacloudapi.cn' : 'https://login.microsoftonline.us'
        })
        credential = this.browser
        via = 'browser'
        found = await this.tryLocate(this.browser, scope, ref, abort.signal, true)
      }
      if (!found) {
        throw new Error(`il server '${ref.name}' non è tra quelli visibili dall'account Azure usato: serve un account con accesso alla sua sottoscrizione`)
      }
      const ruleName = firewallRuleName(hostname())
      const token = await this.token(credential, scope, found.tenantId, abort.signal)
      const res = await fetch(firewallRuleUrl(ref.cloud.armHost, found.server.id, ruleName), {
        method: 'PUT',
        signal: abort.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { startIpAddress: ip, endIpAddress: ip } })
      })
      if (!res.ok) throw new Error(await armError(res, ref.name))
      const id = found.server.id.split('/')
      return {
        ruleName,
        serverName: ref.name,
        subscriptionId: id[2],
        resourceGroup: id[4],
        portalUrl: serverNetworkingPortalUrl(ref.cloud.portalHost, found.server.id),
        via
      }
    } catch (e) {
      if (abort.signal.aborted) throw new Error('autorizzazione annullata')
      throw e
    } finally {
      if (this.running === abort) this.running = null
    }
  }

  private async token(credential: TokenCredential, scope: string, tenantId: string | undefined, signal: AbortSignal): Promise<string> {
    const t = await credential.getToken(scope, { abortSignal: signal, ...(tenantId ? { tenantId } : {}) })
    if (!t?.token) throw new Error('accesso ad Azure non riuscito')
    return t.token
  }

  /**
   * The server among the subscriptions the credential sees, searching the other tenants of the
   * account too (a guest account's server lives in another directory; CLI logins only). Null when the credential
   * cannot sign in (CLI not logged in) or does not see the server; `interactive` rethrows the
   * sign-in errors, which are the user's to read.
   */
  private async tryLocate(
    credential: TokenCredential, scope: string, ref: AzureSqlServerRef, signal: AbortSignal, interactive = false
  ): Promise<{ server: ArmSqlServer; tenantId?: string } | null> {
    let token: string
    try {
      token = await this.token(credential, scope, undefined, signal)
    } catch (e) {
      if (interactive || signal.aborted) throw e
      return null
    }
    const home = await this.findIn(ref, token, signal)
    if (home) return { server: home }
    // the browser sign-in would open one more page per directory: only the CLI logins walk them
    if (interactive) return null
    const tenants = await this.list<{ tenantId: string }>(`https://${ref.cloud.armHost}/tenants?api-version=2022-12-01`, token, signal)
      .catch(() => [])
    const homeTenant = tenantOf(token)
    for (const { tenantId } of tenants) {
      if (!tenantId || tenantId === homeTenant) continue
      let other: string
      try {
        other = await this.token(credential, scope, tenantId, signal)
      } catch {
        if (signal.aborted) throw new Error('autorizzazione annullata')
        continue // MFA / conditional access of that directory: skip it
      }
      const server = await this.findIn(ref, other, signal)
      if (server) return { server, tenantId }
    }
    return null
  }

  private async findIn(ref: AzureSqlServerRef, token: string, signal: AbortSignal): Promise<ArmSqlServer | null> {
    const arm = `https://${ref.cloud.armHost}`
    const subscriptions = await this.list<{ subscriptionId: string; state?: string }>(`${arm}/subscriptions?api-version=2022-12-01`, token, signal)
    const lists = await Promise.all(subscriptions
      .filter(s => s.state !== 'Disabled')
      .map(s => this.list<ArmSqlServer>(`${arm}/subscriptions/${s.subscriptionId}/providers/Microsoft.Sql/servers?api-version=${SQL_ARM_API_VERSION}`, token, signal)
        .catch(() => [] as ArmSqlServer[])))
    return findSqlServer(lists.flat(), ref.name)
  }

  private async list<T>(url: string, token: string, signal: AbortSignal): Promise<T[]> {
    const out: T[] = []
    let next: string | undefined = url
    for (let page = 0; next && page < 50; page++) {
      const res = await fetch(next, { signal, headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`ARM ${res.status}`)
      const body = await res.json() as ArmList<T>
      out.push(...(body.value ?? []))
      next = body.nextLink
    }
    return out
  }
}

/** The tenant a token was issued for (its tid claim). */
function tenantOf(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { tid?: string }
    return payload.tid
  } catch {
    return undefined
  }
}

async function armError(res: Response, server: string): Promise<string> {
  let detail = ''
  try {
    const body = await res.json() as { error?: { code?: string; message?: string } }
    detail = body.error?.message || body.error?.code || ''
  } catch { /* not JSON */ }
  if (res.status === 401 || res.status === 403) {
    return `l'account Azure non ha il permesso di modificare il firewall di '${server}' (serve il ruolo SQL Server Contributor o Contributor)${detail ? `: ${detail}` : ''}`
  }
  return `Azure ha rifiutato la regola firewall (${res.status})${detail ? `: ${detail}` : ''}`
}
