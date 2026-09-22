import { watch } from 'fs'
import type { FSWatcher } from 'fs'
import { readdir } from 'fs/promises'

// Folders that churn constantly or are irrelevant for git changes. `.git` is
// especially important: `git status` can refresh the index, and watching it
// would create a reload -> status -> index-write -> reload loop.
export const IGNORED = /(^|[\\/])(node_modules|\.git|bin|obj|dist|out|\.vs|packages|\.worktrees)([\\/]|$)/i
const MAX_DIRS = 2000

/**
 * Event-driven recursive directory watcher, without external dependencies.
 * Uses recursive `fs.watch` where the platform supports it (Windows/macOS); on
 * Linux (Node 18) it falls back to watching every directory with a bounded walk,
 * re-walking when new directories appear. Returns an async disposer.
 */
export async function watchTree(root: string, onChange: () => void): Promise<() => void> {
  const base = root.replace(/[\\/]+$/, '')

  try {
    const w: FSWatcher = watch(base, { recursive: true }, (_event, filename) => {
      if (filename && IGNORED.test(String(filename))) return
      onChange()
    })
    w.on('error', () => { try { w.close() } catch { /* ignore */ } })
    return () => { try { w.close() } catch { /* ignore */ } }
  } catch { /* fall through to per-directory watchers */ }

  const watchers = new Map<string, FSWatcher>()
  const seen = new Set<string>()

  const addDir = (dir: string): void => {
    const key = dir.replace(/[\\/]+/g, '/').toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    try {
      const w = watch(dir, (_event, filename) => {
        if (filename && IGNORED.test(String(filename))) return
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
      if (!e.isDirectory() || IGNORED.test(e.name)) continue
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
