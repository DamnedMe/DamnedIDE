// Self-check for the Azure SQL firewall helpers: the 40615 login error is recognized in English and
// Italian (the server localizes it), other errors are not, Azure hosts are told apart from
// on-premises servers, and the rule name / ARM pieces are what the service sends.
// Run: node --experimental-strip-types scripts/sql-azure-firewall.check.ts
import assert from 'node:assert/strict'
import {
  azureSqlServerRef, findSqlServer, firewallRuleName, firewallRuleUrl, parseAzureFirewallError,
  parseSqlServerResourceId, serverNetworkingPortalUrl, setFirewallRuleStatement
} from '../src/shared/sqlAzureFirewall.ts'

const it = "Errore: Impossibile aprire il server 'prod-azure-sql-dbserver' richiesto dal login. Il client con indirizzo IP '78.210.67.42' non può accedere al server. Per abilitare l'accesso, utilizza il Portale di Gestione Azure o esegui sp_set_firewall_rule sul database master per creare una regola firewall per questo indirizzo IP o intervallo di indirizzi. Potrebbero richiedere fino a cinque minuti perché questa modifica abbia effetto."
const en = "Cannot open server 'myserver' requested by the login. Client with IP address '203.0.113.7' is not allowed to access the server.  To enable access, use the Windows Azure Management Portal or run sp_set_firewall_rule on the master database to create a firewall rule for this IP address or address range.  It may take up to five minutes for this change to take effect."

assert.deepEqual(parseAzureFirewallError(it), { ip: '78.210.67.42', server: 'prod-azure-sql-dbserver' })
assert.deepEqual(parseAzureFirewallError(en), { ip: '203.0.113.7', server: 'myserver' })
assert.deepEqual(parseAzureFirewallError("Error 40615: Client with IP address '10.0.0.1' is not allowed"), { ip: '10.0.0.1' })
assert.equal(parseAzureFirewallError("Login failed for user 'sa'."), null)
assert.equal(parseAzureFirewallError("Failed to connect to 10.0.0.1:1433 - ETIMEOUT"), null)
assert.equal(parseAzureFirewallError("firewall: Client with IP address '999.1.1.1' is not allowed"), null)
assert.equal(parseAzureFirewallError(''), null)
assert.equal(parseAzureFirewallError(undefined), null)

assert.deepEqual(
  { ...azureSqlServerRef('prod-azure-sql-dbserver.database.windows.net'), cloud: undefined },
  { name: 'prod-azure-sql-dbserver', host: 'prod-azure-sql-dbserver.database.windows.net', cloud: undefined }
)
assert.equal(azureSqlServerRef('tcp:Prod.Database.Windows.Net,1433')?.name, 'prod')
assert.equal(azureSqlServerRef('tcp:prod.database.windows.net,1433')?.cloud.armHost, 'management.azure.com')
assert.equal(azureSqlServerRef('gov.database.usgovcloudapi.net')?.cloud.armHost, 'management.usgovcloudapi.net')
assert.equal(azureSqlServerRef('(localdb)\\MSSQLLocalDB'), null)
assert.equal(azureSqlServerRef('sqlprod01\\SQLEXPRESS'), null)
assert.equal(azureSqlServerRef('my.managed-instance.abc123.database.windows.net'), null) // managed instance: no server firewall
assert.equal(azureSqlServerRef(''), null)

assert.equal(firewallRuleName('DESKTOP-AB12'), 'DamnedIDE_DESKTOP-AB12')
assert.equal(firewallRuleName("Damian's MacBook Pro.local"), 'DamnedIDE_Damian_s_MacBook_Pro_local')
assert.equal(firewallRuleName('  '), 'DamnedIDE_computer')
assert.ok(firewallRuleName('x'.repeat(300)).length <= 128)
assert.doesNotMatch(firewallRuleName('a<b>c*d%e&f:g\\h/i?j.'), /[<>*%&:\\/?]|\.$/)

const id = '/subscriptions/0000-1111/resourceGroups/rg-prod/providers/Microsoft.Sql/servers/prod-azure-sql-dbserver'
assert.deepEqual(parseSqlServerResourceId(id), { subscriptionId: '0000-1111', resourceGroup: 'rg-prod', name: 'prod-azure-sql-dbserver' })
assert.equal(parseSqlServerResourceId('/subscriptions/x/resourceGroups/y/providers/Microsoft.Web/sites/z'), null)
assert.equal(findSqlServer([{ id: id.replace('prod-azure-sql-dbserver', 'other'), name: 'other' }, { id, name: 'Prod-Azure-Sql-DbServer' }], 'prod-azure-sql-dbserver')?.id, id)
assert.equal(findSqlServer([{ id, name: 'prod-azure-sql-dbserver' }], 'missing'), null)
assert.equal(firewallRuleUrl('management.azure.com', id, 'DamnedIDE_PC'),
  `https://management.azure.com${id}/firewallRules/DamnedIDE_PC?api-version=2021-11-01`)
assert.equal(serverNetworkingPortalUrl('portal.azure.com', id), `https://portal.azure.com/#resource${id}/networking`)
assert.equal(setFirewallRuleStatement("it's", '1.2.3.4'),
  "EXECUTE sp_set_firewall_rule @name = N'it''s', @start_ip_address = '1.2.3.4', @end_ip_address = '1.2.3.4';")

console.log('sql azure firewall: ok')
