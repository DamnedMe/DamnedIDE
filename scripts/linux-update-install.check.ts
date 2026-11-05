// Self-check for the native Linux update install and the updater log (no real install runs).
// Run: node --experimental-strip-types scripts/linux-update-install.check.ts
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  NATIVE_PACKAGE_NAME,
  buildInstalledVersionQuery,
  buildNativeInstallCommand,
  feedCarriesPackage,
  installFailureMessage,
  manualInstallCommand,
  outputTail,
  pacmanSupportsDisableSandbox,
  parseInstalledVersion,
  runCapture,
  sameVersion,
  stagePackage
} from '../electron/services/update/linux-install.ts'
import { createUpdateLog, formatLogLines, oldLogPath } from '../electron/services/update/update-log.ts'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(NATIVE_PACKAGE_NAME, pkg.name, 'the distro package is named after package.json')

// ─── install command ───
const staged = '/tmp/damned-ide-update-abc/damned-ide-0.0.23.pacman'
assert.deepEqual(
  buildNativeInstallCommand('pacman', staged),
  ['/usr/bin/pkexec', '/usr/bin/pacman', '-U', '--noconfirm', '--overwrite', '*', staged],
  'no --disable-sandbox unless this pacman lists it'
)
assert.deepEqual(
  buildNativeInstallCommand('pacman', staged, { pkexec: 'pkexec', disableSandbox: true }),
  ['pkexec', '/usr/bin/pacman', '-U', '--noconfirm', '--disable-sandbox', '--overwrite', '*', staged]
)
assert.deepEqual(buildNativeInstallCommand('deb', '/tmp/x.deb'), ['/usr/bin/pkexec', 'dpkg', '-i', '/tmp/x.deb'])
assert.deepEqual(buildNativeInstallCommand('rpm', '/tmp/x.rpm', { pkexec: 'pkexec' }), ['pkexec', 'rpm', '-Uvh', '/tmp/x.rpm'])
assert.equal(manualInstallCommand('pacman', '/c/x.pacman'), "sudo pacman -U --overwrite '*' /c/x.pacman")

// `pacman -Uh` (as the user): the plain flag only
const pacman7Help = `usage:  pacman {-U --upgrade} [options] <file(s)>
options:
      --disable-download-timeout
                       use relaxed timeouts for download
      --disable-sandbox
                       disable the sandbox used for the downloader process
      --overwrite <glob>`
const pacman6Help = `usage:  pacman {-U --upgrade} [options] <file(s)>
options:
      --disable-download-timeout
      --overwrite <glob>`
const splitFlagsHelp = `      --disable-sandbox-filesystem
      --disable-sandbox-syscalls`
assert.equal(pacmanSupportsDisableSandbox(pacman7Help), true)
assert.equal(pacmanSupportsDisableSandbox(pacman6Help), false)
assert.equal(pacmanSupportsDisableSandbox(splitFlagsHelp), false, '--disable-sandbox-filesystem is another flag')
assert.equal(pacmanSupportsDisableSandbox(''), false)

// ─── installed-version verification ───
assert.deepEqual(buildInstalledVersionQuery('pacman'), ['/usr/bin/pacman', '-Q', 'damned-ide'])
assert.deepEqual(buildInstalledVersionQuery('deb'), ['dpkg-query', '-W', '-f=${Version}', 'damned-ide'])
assert.deepEqual(buildInstalledVersionQuery('rpm'), ['rpm', '-q', '--qf', '%{VERSION}', 'damned-ide'])

assert.equal(parseInstalledVersion('pacman', 'damned-ide 0.0.22-1\n'), '0.0.22-1')
assert.equal(parseInstalledVersion('pacman', ''), null, 'not installed: pacman prints the error on stderr')
assert.equal(parseInstalledVersion('pacman', 'other-pkg 1.0.0-1'), null)
assert.equal(parseInstalledVersion('deb', '0.0.22'), '0.0.22')
assert.equal(parseInstalledVersion('deb', ''), null)
assert.equal(parseInstalledVersion('rpm', '0.0.22'), '0.0.22')
assert.equal(parseInstalledVersion('rpm', 'package damned-ide is not installed\n'), null)

assert.equal(sameVersion('0.0.22-1', '0.0.22'), true, 'pacman/deb package release suffix')
assert.equal(sameVersion('0.0.22', '0.0.22'), true)
assert.equal(sameVersion('1:0.0.22-3', 'v0.0.22'), true, 'epoch and v prefix')
assert.equal(sameVersion('0.0.23_beta.1-1', '0.0.23-beta.1'), true, 'pacman/rpm write - as _')
assert.equal(sameVersion('0.0.21-1', '0.0.22'), false, 'the old version is still installed')
assert.equal(sameVersion('0.0.2', '0.0.22'), false)
assert.equal(sameVersion('', '0.0.22'), false)

// ─── feed / errors ───
assert.equal(feedCarriesPackage([{ url: 'DamnedIDE-0.0.22.AppImage' }, { url: 'damned-ide-0.0.22.pacman' }], 'pacman'), true)
assert.equal(feedCarriesPackage([{ url: 'DamnedIDE-0.0.22.AppImage' }], 'pacman'), false)
assert.equal(feedCarriesPackage(undefined, 'deb'), false)

assert.equal(outputTail('a\n\nb\nc\nd\n', 2), 'c\nd')
assert.match(installFailureMessage(126, ''), /annullata/)
assert.match(installFailureMessage(127, ''), /autorizzazione/)
assert.equal(installFailureMessage(1, 'loading packages...\nerror: failed to commit transaction (conflicting files)\n'), 'loading packages...\nerror: failed to commit transaction (conflicting files)')
assert.match(installFailureMessage(1, ''), /codice 1/)

// ─── real spawn: stdout + stderr captured, exit code, missing command ───
const run = await runCapture([process.execPath, '-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'], 20_000)
assert.equal(run.code, 3)
assert.equal(run.stdout, 'out')
assert.equal(run.stderr, 'err')
const missing = await runCapture(['damned-ide-no-such-command-xyz'], 20_000)
assert.equal(missing.code, null)
assert.equal(missing.notFound, true)
const slow = await runCapture([process.execPath, '-e', 'setTimeout(() => {}, 10000)'], 200)
assert.equal(slow.error, 'tempo scaduto')

// ─── staging: a 0644 copy in a fresh 0755 dir under the system tmp ───
const work = mkdtempSync(join(tmpdir(), 'damned-update-check-'))
try {
  const downloaded = join(work, 'damned-ide-0.0.23.pacman')
  writeFileSync(downloaded, 'package bytes')
  const copy = await stagePackage(downloaded)
  try {
    assert.equal(dirname(copy.file), copy.dir)
    assert.ok(copy.dir.startsWith(join(tmpdir(), 'damned-ide-update-')))
    assert.equal(readFileSync(copy.file, 'utf8'), 'package bytes')
    if (process.platform !== 'win32') {
      assert.equal(statSync(copy.dir).mode & 0o777, 0o755)
      assert.equal(statSync(copy.file).mode & 0o777, 0o644)
    }
  } finally {
    rmSync(copy.dir, { recursive: true, force: true })
  }

  // ─── updater log: ISO timestamp + pid per line, roll-over past the limit ───
  const line = formatLogLines('info', 'one\ntwo', new Date('2026-01-02T03:04:05.000Z'), 42)
  assert.equal(line, '2026-01-02T03:04:05.000Z [42] INFO one\n2026-01-02T03:04:05.000Z [42] INFO two\n')
  const logFile = join(work, 'logs', 'updater.log')
  assert.equal(oldLogPath(logFile), join(work, 'logs', 'updater.old.log'))
  const log = createUpdateLog(logFile, 200)
  log.info('first')
  log.error(new Error('boom'))
  assert.match(readFileSync(logFile, 'utf8'), /^\d{4}-\d\d-\d\dT[\d:.]+Z \[\d+\] INFO first\n/)
  assert.match(readFileSync(logFile, 'utf8'), /ERROR Error: boom/)
  log.info('x'.repeat(300))
  log.info('after roll-over')
  assert.ok(existsSync(oldLogPath(logFile)), 'past the limit the log rolls over to updater.old.log')
  assert.match(readFileSync(logFile, 'utf8'), /INFO after roll-over\n$/)
  assert.doesNotMatch(readFileSync(logFile, 'utf8'), /first/)
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log('ok — linux update install')
