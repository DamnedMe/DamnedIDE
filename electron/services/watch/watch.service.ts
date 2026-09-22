import { BrowserWindow } from 'electron'
import { watchTree } from './tree-watcher'

const DEBOUNCE_MS = 400

interface WatchedRoot {
  refs: number
  close: () => void
}

const roots = new Map<string, WatchedRoot>()

function emit(root: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('fs:changed', { root }) } catch { /* window closed */ }
  }
}

// One watcher per root, refcounted by the renderers using it; events are
// debounced so a burst of writes (an agent saving many files) becomes one reload.
export function watchRoot(root: string): void {
  const existing = roots.get(root)
  if (existing) { existing.refs++; return }
  const entry: WatchedRoot = { refs: 1, close: () => { /* set when ready */ } }
  roots.set(root, entry)

  let timer: NodeJS.Timeout | undefined
  const onChange = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; emit(root) }, DEBOUNCE_MS)
  }

  watchTree(root, onChange).then((close) => {
    if (roots.get(root) === entry) entry.close = close
    else close()
  }).catch(() => { /* ignore */ })
}

export function unwatchRoot(root: string): void {
  const entry = roots.get(root)
  if (!entry) return
  entry.refs--
  if (entry.refs > 0) return
  try { entry.close() } catch { /* ignore */ }
  roots.delete(root)
}

export function closeAllWatchers(): void {
  for (const entry of roots.values()) {
    try { entry.close() } catch { /* ignore */ }
  }
  roots.clear()
}
