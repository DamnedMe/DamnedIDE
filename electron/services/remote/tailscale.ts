import { execFile } from 'child_process'
import { networkInterfaces } from 'os'

export interface TailscaleStatus {
  /** The `tailscale` binary was found and answered. */
  available: boolean
  /** Tailscale is up and the node has an address. */
  running: boolean
  /** MagicDNS name, without the trailing dot (e.g. `pc.tailnet.ts.net`). */
  dnsName: string | null
  ipv4: string | null
  ipv6: string | null
  error?: string
}

const CANDIDATES =
  process.platform === 'win32'
    ? ['tailscale.exe', 'tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe']
    : ['tailscale', '/usr/bin/tailscale', '/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']

function run(bin: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, windowsHide: true }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

/** Query `tailscale status --json` and normalise the fields we care about. */
export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  let lastError: string | undefined
  for (const bin of CANDIDATES) {
    try {
      const out = await run(bin, ['status', '--json'])
      const parsed = JSON.parse(out) as {
        Self?: { DNSName?: string; TailscaleIPs?: string[] }
        BackendState?: string
      }
      const self = parsed.Self
      const ips = self?.TailscaleIPs ?? []
      const ipv4 = ips.find((ip) => !ip.includes(':')) ?? null
      const ipv6 = ips.find((ip) => ip.includes(':')) ?? null
      const dnsName = self?.DNSName ? self.DNSName.replace(/\.$/, '') : null
      return {
        available: true,
        running: parsed.BackendState === 'Running' && !!ipv4,
        dnsName,
        ipv4,
        ipv6
      }
    } catch (err) {
      lastError = (err as Error)?.message || String(err)
    }
  }
  return { available: false, running: false, dnsName: null, ipv4: null, ipv6: null, error: lastError }
}

/** First non-internal IPv4 of the machine (LAN fallback when Tailscale is absent). */
export function getLanIp(): string | null {
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}
