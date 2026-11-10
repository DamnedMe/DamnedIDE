import { watch, existsSync } from 'fs'
import type { FSWatcher } from 'fs'
import { readdir } from 'fs/promises'
import { join } from 'path'

// Folders that churn constantly or are irrelevant for git changes. `.git` is
// especially important: `git status` can refresh the index, and watching it
// would create a reload -> status -> index-write -> reload loop.
export const IGNORED = /(^|[\\/])(node_modules|\.git|bin|obj|dist|out|\.vs|packages|\.worktrees)([\\/]|$)/i
const MAX_DIRS = 2000
const MAX_CACHED = 5000

/**
 * Ignore rule for paths relative to the watched `base`: the IGNORED names, plus anything inside a
 * nested repository or worktree, i.e. a subfolder holding a `.git` file or folder. Worktrees can
 * live inside the main checkout under any name (Settings › Git › Worktree root '.', 'wt'...), and
 * their edits are not changes of this checkout. `base` itself is never ignored: it may well be a
 * worktree.
 * ponytail: one existsSync per path part (file names included), cached. A cached "not nested" is forgotten when an event
 * names that folder's `.git` (a worktree created while the watcher runs); past MAX_CACHED paths the
 * cache is just dropped, no LRU. The folder holding the worktrees (`feature/`) is not ignored, so
 * Windows can still report it once when its last-access time moves, like any read of the checkout.
 */
export function createIgnore(base: string): (rel: string) => boolean {
  const nested = new Map<string, boolean>()
  return (rel) => {
    const parts = rel.split(/[\\/]+/).filter(Boolean)
    if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === '.git') nested.delete(parts.slice(0, -1).join('/'))
    // before the per-folder checks: `.git/objects/..` writes must not cost a syscall each
    if (IGNORED.test(rel)) return true
    let prefix = ''
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part
      let hit = nested.get(prefix)
      if (hit === undefined) {
        if (nested.size >= MAX_CACHED) nested.clear()
        hit = existsSync(join(base, prefix, '.git'))
        nested.set(prefix, hit)
      }
      if (hit) return true
    }
    return false
  }
}

/**
 * Event-driven recursive directory watcher, without external dependencies.
 * Uses recursive `fs.watch` where the platform supports it (Windows/macOS); on
 * Linux (Node 18) it falls back to watching every directory with a bounded walk,
 * re-walking when new directories appear. Returns an async disposer.
 */
export async function watchTree(root: string, onChange: () => void): Promise<() => void> {
  const base = root.replace(/[\\/]+$/, '')
  const ignored = createIgnore(base)

  try {
    const w: FSWatcher = watch(base, { recursive: true }, (_event, filename) => {
      if (filename && ignored(String(filename))) return
      onChange()
    })
    w.on('error', () => { try { w.close() } catch { /* ignore */ } })
    return () => { try { w.close() } catch { /* ignore */ } }
  } catch { /* fall through to per-directory watchers */ }

  const watchers = new Map<string, FSWatcher>()
  const seen = new Set<string>()
  // walk() builds every path as `${base}/...`
  const relOf = (dir: string, name: string) => (dir === base ? name : `${dir.slice(base.length + 1)}/${name}`)

  const addDir = (dir: string): void => {
    const key = dir.replace(/[\\/]+/g, '/').toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    try {
      const w = watch(dir, (_event, filename) => {
        if (filename && ignored(relOf(dir, String(filename)))) return
        onChange()
        // a new subdirectory needs its own watcher
        void walk(dir)
      })
      w.on('error', () => { try { w.close() } catch { /* ignore */ }; watchers.delete(dir) })
      watchers.set(dir, w)
    } catch { /* unreadable */ }
  }

  const walk = async (dir: string): Promise<void> => {
    addDir(dir)
    if (watchers.size >= MAX_DIRS) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch { return }
    for (const e of entries) {
      if (!e.isDirectory() || ignored(relOf(dir, e.name))) continue
      await walk(`${dir}/${e.name}`)
    }
  }

  await walk(base)

  return () => {
    for (const w of watchers.values()) {
      try { w.close() } catch { /* ignore */ }
    }
    watchers.clear()
  }
}
