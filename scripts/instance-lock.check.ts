// Self-check for the one-owner lock shared by IDE instances (updates, release chains).
// Run: node --experimental-strip-types scripts/instance-lock.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir, uptime } from 'node:os'
import { join } from 'node:path'
import { acquireInstanceLock, lockOwner, releaseInstanceLock } from '../electron/services/process/instance-lock.ts'

const dir = mkdtempSync(join(tmpdir(), 'damned-lock-'))
const file = join(dir, 'updater.lock')
const alive = new Set([100, 200])
const isAlive = (pid: number) => alive.has(pid)
try {
  // the first instance owns it, a second live instance does not
  assert.equal(acquireInstanceLock(file, 100, isAlive), true)
  assert.equal(acquireInstanceLock(file, 200, isAlive), false, 'one owner at a time')
  assert.equal(acquireInstanceLock(file, 100, isAlive), true, 're-acquiring is idempotent')
  assert.equal(lockOwner(file)?.pid, 100)

  // only the owner can release it
  releaseInstanceLock(file, 200)
  assert.equal(lockOwner(file)?.pid, 100, 'a non-owner release is ignored')

  // the owner dies without releasing (crash): the next instance takes over
  alive.delete(100)
  assert.equal(acquireInstanceLock(file, 200, isAlive), true, 'a dead owner is taken over')
  assert.equal(lockOwner(file)?.pid, 200)

  // clean release frees it for anyone
  releaseInstanceLock(file, 200)
  assert.equal(existsSync(file), false)
  assert.equal(acquireInstanceLock(file, 300, isAlive), true)
  releaseInstanceLock(file, 300)

  // a lock left by the previous boot (shutdown, crash) is stale even when its pid is alive
  // now: after a reboot that pid may be any process
  writeFileSync(file, JSON.stringify({ pid: 100, since: Date.now() - uptime() * 1000 - 3_600_000 }))
  alive.add(100)
  assert.equal(acquireInstanceLock(file, 200, isAlive), true, 'a lock older than this boot is taken over')
  assert.equal(lockOwner(file)?.pid, 200)
  releaseInstanceLock(file, 200)

  // a corrupt lock file is treated as stale
  writeFileSync(file, 'not json')
  assert.equal(acquireInstanceLock(file, 200, isAlive), true, 'unreadable lock is replaced')
  releaseInstanceLock(file, 200)

  // real liveness probe: this process is alive, so a lock held by it is respected
  assert.equal(acquireInstanceLock(file, process.pid), true)
  assert.equal(acquireInstanceLock(file, 999999), false, 'held by a live pid (this process)')
  releaseInstanceLock(file)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log('ok — instance-lock')
