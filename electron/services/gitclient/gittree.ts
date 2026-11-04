import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { posix, win32 } from 'path'

// GitTree (https://github.com/giannoccarol/gittree): external Electron git
// client. Single-instance: a second launch focuses the running window and
// hands over the deep link, so repeated launches never open a second window.
export const GITTREE_DOWNLOAD_URL = 'https://github.com/giannoccarol/gittree/releases/latest'

/** Known install locations, in detection order. */
export function gitTreeCandidates(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') {
    return [
      // per-machine NSIS install, then per-user NSIS install
      win32.join(env.ProgramFiles || 'C:\\Program Files', 'GitTree', 'GitTree.exe'),
      ...(env.LOCALAPPDATA ? [win32.join(env.LOCALAPPDATA, 'Programs', 'GitTree', 'GitTree.exe')] : [])
    ]
  }
  if (platform === 'darwin') return ['/Applications/GitTree.app/Contents/MacOS/GitTree']
  // electron-builder deb/pacman install to /opt/<productName> and link the binary into PATH
  const onPath = (env.PATH || '').split(':').filter(Boolean).map(dir => posix.join(dir, 'gittree'))
  return [...onPath, '/opt/GitTree/gittree']
}

interface FindOptions {
  platform?: string
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
}

/** The saved path wins while it still exists, then the first installed candidate. */
export function findGitTree(saved?: string | null, opts: FindOptions = {}): string | null {
  const exists = opts.exists ?? existsSync
  if (saved && exists(saved)) return saved
  return gitTreeCandidates(opts.platform, opts.env).find(p => exists(p)) ?? null
}

/** gittree://open?path=<abs working-tree root>, the link GitTree reads from argv. */
export function gitTreeDeepLink(repoPath: string): string {
  const url = new URL('gittree://open')
  url.searchParams.set('path', repoPath)
  return url.href
}

/**
 * Starts GitTree on a repository. Detached and unref'd, outside the process
 * service, so it survives the IDE; no shell, so the encoded URL is not mangled.
 */
export function launchGitTree(exe: string, repoPath: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    try {
      const child = spawn(exe, [gitTreeDeepLink(repoPath)], { detached: true, stdio: 'ignore' })
      child.once('spawn', () => { child.unref(); resolve({ ok: true }) })
      child.once('error', (e) => resolve({ ok: false, error: e.message }))
    } catch (e) {
      resolve({ ok: false, error: (e as Error).message })
    }
  })
}
