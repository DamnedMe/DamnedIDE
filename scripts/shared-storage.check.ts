// Self-check for the localStorage copy shared by every IDE instance.
// Run: node --experimental-strip-types scripts/shared-storage.check.ts
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSharedStorage, readSharedStorage, setSharedItem } from '../electron/services/storage/shared-storage.ts'

const dir = mkdtempSync(join(tmpdir(), 'damned-storage-'))
const file = join(dir, 'renderer-storage.json')
try {
  // first launch after the upgrade: the owner of Chromium's localStorage seeds the file
  const first = loadSharedStorage(file, { damnedide_settings: '{"fontSize":20}', damnedide_last_panel: 'git' })
  assert.equal(first.damnedide_settings, '{"fontSize":20}')
  assert.equal(readSharedStorage(file).damnedide_last_panel, 'git', 'seeded into the file')

  // a second instance starts empty: it gets everything from the file
  const second = loadSharedStorage(file, {})
  assert.deepEqual(second, first)

  // its writes reach the file, removals too
  setSharedItem(file, 'damnedide_settings', '{"fontSize":14}')
  setSharedItem(file, 'damnedide_last_panel', null)
  assert.deepEqual(readSharedStorage(file), { damnedide_settings: '{"fontSize":14}' })

  // the first instance restarts with its stale LevelDB copy: the file wins, its extra keys fill gaps
  const again = loadSharedStorage(file, { damnedide_settings: '{"fontSize":20}', damnedide_recent_repos: '["C:/r"]' })
  assert.equal(again.damnedide_settings, '{"fontSize":14}', 'shared copy wins on conflicts')
  assert.equal(again.damnedide_recent_repos, '["C:/r"]', 'local-only keys are kept')
  assert.equal(readSharedStorage(file).damnedide_recent_repos, '["C:/r"]')

  // unreadable file: reads as empty, never throws
  writeFileSync(file, '{ broken')
  assert.deepEqual(readSharedStorage(file), {})
  assert.ok(!existsSync(`${file}.${process.pid}.tmp`), 'no temp file left behind')
  console.log('shared-storage: ok')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
