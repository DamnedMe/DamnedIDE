// Manual check: closes the Explorer window showing a temp folder.
// Run: node --experimental-strip-types scripts/explorer-close.check.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { closeExplorerWindowsAt } from '../electron/services/process/windows-handles.ts'

if (process.platform !== 'win32') {
  console.log('skip — Windows only')
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'damned-explorer-'))
spawnSync('explorer.exe', [dir])
await new Promise((r) => setTimeout(r, 2500))

const closed = await closeExplorerWindowsAt(dir)
await new Promise((r) => setTimeout(r, 800))
const stillOpen = await closeExplorerWindowsAt(dir)

console.log(`closed=${closed} stillOpenAfter=${stillOpen}`)
rmSync(dir, { recursive: true, force: true })

if (closed === 0) {
  console.error('NESSUNA finestra chiusa: la detection non ha funzionato')
  process.exit(1)
}
if (stillOpen !== 0) {
  console.error('la finestra risulta ancora aperta dopo la chiusura')
  process.exit(1)
}
console.log('ok — explorer close')
