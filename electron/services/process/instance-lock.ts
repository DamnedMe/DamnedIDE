// One-owner lock shared by every IDE instance on the same profile (several instances
// run at once, one per repository). The owner is the only one that does a job that must
// not run twice: downloading/installing updates (they share one pending cache, and an
// instance re-validating it empties the folder under the other's feet) or polling the
// release chains. The lock file holds the owner's pid; a dead owner is taken over.
// No electron import: node checks exercise it directly.
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'fs'
import { uptime } from 'os'

export interface LockOwner { pid: number; since: number }

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM: the process exists but belongs to someone else
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function lockOwner(file: string): LockOwner | null {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return typeof data?.pid === 'number' ? { pid: data.pid, since: Number(data.since) || 0 } : null
  } catch {
    return null
  }
}

/**
 * A lock written before this boot is stale whatever its pid: a shutdown or a crash
 * left it behind and the pid may now belong to any process (a system one reads as
 * alive through EPERM). One minute of slack for the clock and the uptime rounding.
 */
function writtenBeforeBoot(owner: LockOwner): boolean {
  return owner.since < Date.now() - uptime() * 1000 - 60_000
}

/**
 * True when this process owns the lock (it just took it, it already had it, or the
 * previous owner is gone).
 * ponytail: liveness is `kill(pid, 0)`; within one boot a recycled pid of an unrelated
 * process keeps the lock held until that process exits — add a start-time check if that
 * ever bites.
 */
export function acquireInstanceLock(file: string, pid = process.pid, isAlive = defaultIsAlive): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx')
      try { writeSync(fd, JSON.stringify({ pid, since: Date.now() })) } finally { closeSync(fd) }
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return false
    }
    const owner = lockOwner(file)
    if (owner?.pid === pid) return true
    if (owner && !writtenBeforeBoot(owner) && isAlive(owner.pid)) return false
    // stale (dead owner, previous boot) or unreadable: drop it and try once more
    try { unlinkSync(file) } catch { /* another instance took it first */ }
  }
  return false
}

/** Releases the lock only when this process owns it. */
export function releaseInstanceLock(file: string, pid = process.pid): void {
  if (lockOwner(file)?.pid !== pid) return
  try { unlinkSync(file) } catch { /* already gone */ }
}
