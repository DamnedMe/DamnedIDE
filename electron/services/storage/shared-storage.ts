// Renderer localStorage shared by every IDE instance.
// Several instances may run at once on one profile (one per repository), but
// Chromium's localStorage (LevelDB) is locked by the first one: the others
// start empty and lose their writes on exit. This JSON file in userData is the
// copy they all share; the preload seeds localStorage from it at startup.
import { readFileSync, writeFileSync, renameSync, rmSync } from 'fs'

export type StorageMap = Record<string, string>

export function readSharedStorage(file: string): StorageMap {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

function writeSharedStorage(file: string, data: StorageMap): void {
  const json = JSON.stringify(data)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, json)
  try {
    // atomic replace: another instance never reads half a file
    renameSync(tmp, file)
  } catch {
    writeFileSync(file, json)
    rmSync(tmp, { force: true })
  }
}

/** Startup: the shared file wins on conflicts, what this instance holds only fills the gaps. */
export function loadSharedStorage(file: string, local: StorageMap): StorageMap {
  const shared = readSharedStorage(file)
  const merged = { ...local, ...shared }
  if (Object.keys(merged).length > Object.keys(shared).length) writeSharedStorage(file, merged)
  return merged
}

// ponytail: read-modify-write per change, two instances writing in the same instant can drop one change
export function setSharedItem(file: string, key: string, value: string | null): void {
  const data = readSharedStorage(file)
  if (value === null) delete data[key]
  else data[key] = value
  writeSharedStorage(file, data)
}
