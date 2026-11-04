// Self-check for the GitTree launcher helpers (detection and deep link).
// Never launches GitTree. Run: node --experimental-strip-types scripts/gittree.check.ts
import assert from 'node:assert/strict'
import { gitTreeCandidates, findGitTree, gitTreeDeepLink, GITTREE_DOWNLOAD_URL } from '../electron/services/gitclient/gittree.ts'

// Deep link: round trip through the same parse GitTree does (host 'open', ?path=)
for (const p of ['C:\\Source\\Repos\\My Repo', 'C:\\work\\a#b&c%20d e', '/home/u/repo', '/home/u/my repo #1 & 100%']) {
  const url = new URL(gitTreeDeepLink(p))
  assert.equal(url.protocol, 'gittree:', `protocol for ${p}`)
  assert.equal(url.hostname, 'open', `host for ${p}`)
  assert.equal(url.searchParams.get('path'), p, `path round trip for ${p}`)
  assert.equal(url.hash, '', `no fragment leaks out of ${p}`)
}

// Candidates per platform
const winEnv = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
assert.deepEqual(gitTreeCandidates('win32', winEnv), [
  'C:\\Program Files\\GitTree\\GitTree.exe',
  'C:\\Users\\u\\AppData\\Local\\Programs\\GitTree\\GitTree.exe'
], 'win32: per-machine then per-user install')
assert.deepEqual(gitTreeCandidates('win32', {}), ['C:\\Program Files\\GitTree\\GitTree.exe'], 'win32: Program Files fallback without env')
assert.deepEqual(gitTreeCandidates('linux', { PATH: '/usr/local/bin:/usr/bin' }), [
  '/usr/local/bin/gittree',
  '/usr/bin/gittree',
  '/opt/GitTree/gittree'
], 'linux: PATH entries then /opt')
assert.deepEqual(gitTreeCandidates('darwin', {}), ['/Applications/GitTree.app/Contents/MacOS/GitTree'], 'darwin: app bundle binary')

// findGitTree precedence with an injected exists()
const has = (...paths: string[]) => (p: string) => paths.includes(p)
const opts = (exists: (p: string) => boolean) => ({ platform: 'win32', env: winEnv, exists })
const machine = 'C:\\Program Files\\GitTree\\GitTree.exe'
const user = 'C:\\Users\\u\\AppData\\Local\\Programs\\GitTree\\GitTree.exe'
const saved = 'D:\\tools\\GitTree\\GitTree.exe'
assert.equal(findGitTree(saved, opts(has(saved, machine))), saved, 'an existing saved path wins')
assert.equal(findGitTree(saved, opts(has(machine, user))), machine, 'a missing saved path falls back to the first installed candidate')
assert.equal(findGitTree('', opts(has(user))), user, 'empty saved path: per-user install is found')
assert.equal(findGitTree(null, opts(has())), null, 'nothing installed: null')
assert.equal(findGitTree(undefined, { platform: 'linux', env: { PATH: '/usr/bin' }, exists: has('/opt/GitTree/gittree') }), '/opt/GitTree/gittree', 'linux: /opt install')

assert.match(GITTREE_DOWNLOAD_URL, /^https:\/\/github\.com\/giannoccarol\/gittree\/releases\/latest$/)

console.log('ok — gittree')
