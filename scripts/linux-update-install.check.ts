// Self-check for the native Linux install command (no real install runs).
// Run: node --experimental-strip-types scripts/linux-update-install.check.ts
import assert from 'node:assert/strict'
import { buildNativeInstallCommand } from '../electron/services/update/linux-install.ts'

assert.deepEqual(
  buildNativeInstallCommand('pacman', '/home/u/.cache/damned-ide-updater/pending/damned-ide-0.0.19.pacman'),
  [
    '/usr/bin/pkexec',
    '/usr/bin/pacman',
    '-U',
    '--noconfirm',
    '--disable-sandbox',
    '--overwrite',
    '*',
    '/home/u/.cache/damned-ide-updater/pending/damned-ide-0.0.19.pacman'
  ]
)
assert.deepEqual(
  buildNativeInstallCommand('deb', '/tmp/x.deb'),
  ['/usr/bin/pkexec', 'dpkg', '-i', '/tmp/x.deb']
)
assert.deepEqual(
  buildNativeInstallCommand('rpm', '/tmp/x.rpm', 'pkexec'),
  ['pkexec', 'rpm', '-Uvh', '/tmp/x.rpm']
)

console.log('ok — linux update install')
