// Azure SQL server-level firewall: recognizing the "client IP not allowed" login error (40615) and the
// pure pieces of the ARM calls that add a rule for that IP. No imports: the main process, the renderer
// and scripts/sql-azure-firewall.check.ts all load this file.

export interface AzureFirewallBlock {
  /** the public IP Azure saw: the one the rule must allow */
  ip: string
  /** the logical server named by the error, when it names one */
  server?: string
}

const IPV4 = String.raw`(\d{1,3}(?:\.\d{1,3}){3})`
// "Client with IP address '1.2.3.4' is not allowed…" / "Il client con indirizzo IP '1.2.3.4' non può accedere…"
// and the other localizations: the IP is quoted a few words after "IP"
const IP_IN_MESSAGE = new RegExp(String.raw`\bIP\b[^'"\n]{0,40}['"]` + IPV4 + `['"]`, 'i')
// "Cannot open server 'x'…" / "Impossibile aprire il server 'x'…"
const SERVER_IN_MESSAGE = /\bserver\s+['"]([^'"\s]+)['"]/i

/**
 * The firewall block an Azure SQL login error describes, or null for any other error. The error text
 * is localized by the server (the client's language), so it is recognized by its error number, the
 * stored procedure it suggests or the word "firewall", and by an IPv4 quoted after "IP".
 */
export function parseAzureFirewallError(message: string | null | undefined): AzureFirewallBlock | null {
  if (!message) return null
  if (!/\b40615\b|sp_set_firewall_rule|firewall/i.test(message)) return null
  const ip = IP_IN_MESSAGE.exec(message)?.[1]
  if (!ip || ip.split('.').some(part => Number(part) > 255)) return null
  const server = SERVER_IN_MESSAGE.exec(message)?.[1]
  return { ip, ...(server ? { server } : {}) }
}

export interface AzureSqlCloud {
  /** suffix of the server hosts, e.g. database.windows.net */
  dnsSuffix: string
  /** Azure Resource Manager host of that cloud */
  armHost: string
  /** Azure portal host of that cloud */
  portalHost: string
}

const CLOUDS: AzureSqlCloud[] = [
  { dnsSuffix: 'database.windows.net', armHost: 'management.azure.com', portalHost: 'portal.azure.com' },
  { dnsSuffix: 'database.usgovcloudapi.net', armHost: 'management.usgovcloudapi.net', portalHost: 'portal.azure.us' },
  { dnsSuffix: 'database.chinacloudapi.cn', armHost: 'management.chinacloudapi.cn', portalHost: 'portal.azure.cn' }
]

export interface AzureSqlServerRef {
  /** the logical server name: the first label of the host */
  name: string
  host: string
  cloud: AzureSqlCloud
}

/**
 * The Azure SQL logical server a connection's server field points at, or null when it is not an Azure
 * SQL host (an on-premises server has no Azure firewall). Accepts `tcp:` prefixes and `,port` suffixes.
 */
export function azureSqlServerRef(server: string | null | undefined): AzureSqlServerRef | null {
  if (!server) return null
  const host = server.trim().replace(/^tcp:/i, '').replace(/,\s*\d+\s*$/, '').replace(/\\.*$/, '').trim().toLowerCase()
  for (const cloud of CLOUDS) {
    if (host.endsWith(`.${cloud.dnsSuffix}`)) {
      const name = host.slice(0, -(cloud.dnsSuffix.length + 1))
      if (name && !name.includes('.')) return { name, host, cloud }
    }
  }
  return null
}

/**
 * The firewall rule DamnedIDE writes for this computer. One stable name per computer, so authorizing
 * a new IP replaces the rule of the previous one instead of piling up a rule per network. Azure
 * forbids < > * % & : \ / ? in the name and a trailing dot, and allows at most 128 characters.
 */
export function firewallRuleName(computerName: string): string {
  const safe = computerName.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'computer'
  return `DamnedIDE_${safe}`.slice(0, 128)
}

export interface ArmSqlServer {
  id: string
  name: string
}

export interface ArmResourceId {
  subscriptionId: string
  resourceGroup: string
  name: string
}

/** The pieces of /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.Sql/servers/{name}. */
export function parseSqlServerResourceId(id: string): ArmResourceId | null {
  const m = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.Sql\/servers\/([^/]+)$/i.exec(id.trim())
  return m ? { subscriptionId: m[1], resourceGroup: m[2], name: m[3] } : null
}

/** The server of that name in an ARM list of Microsoft.Sql/servers (names are case-insensitive). */
export function findSqlServer(servers: ArmSqlServer[], name: string): ArmSqlServer | null {
  const wanted = name.toLowerCase()
  return servers.find(s => s.name?.toLowerCase() === wanted && parseSqlServerResourceId(s.id)) ?? null
}

export const SQL_ARM_API_VERSION = '2021-11-01'

export function firewallRuleUrl(armHost: string, serverId: string, ruleName: string): string {
  return `https://${armHost}${serverId}/firewallRules/${encodeURIComponent(ruleName)}?api-version=${SQL_ARM_API_VERSION}`
}

/** The server's "Networking" page in the portal, where the rules can be checked or removed. */
export function serverNetworkingPortalUrl(portalHost: string, serverId: string): string {
  return `https://${portalHost}/#resource${serverId}/networking`
}

/** The T-SQL an admin can run on master instead, from a network the firewall already allows. */
export function setFirewallRuleStatement(ruleName: string, ip: string): string {
  const name = ruleName.replace(/'/g, "''")
  return `EXECUTE sp_set_firewall_rule @name = N'${name}', @start_ip_address = '${ip}', @end_ip_address = '${ip}';`
}
