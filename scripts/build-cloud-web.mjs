// Builds the DamnedCloud web app into resources/cloud-web before packaging: the remote bridge
// serves it as the LAN webapp (same port, same pairing as the APK). The DamnedCloud sources come
// from DAMNEDCLOUD_DIR (CI checks the repository out there) or the sibling ../DamnedCloud folder.
// Without them the script exits 0 and the package simply ships no webapp.
import { spawnSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'

const source = resolve(process.env.DAMNEDCLOUD_DIR || join('..', 'DamnedCloud'))
const out = resolve('resources', 'cloud-web')

if (!existsSync(join(source, 'package.json'))) {
  console.warn(`[cloud-web] DamnedCloud non trovato in ${source}: il package non avrà la webapp LAN`)
  process.exit(0)
}

// npm is npm.cmd on Windows: it needs a shell; the arguments are fixed strings
const run = (args) => spawnSync(['npm', ...args].join(' '), { cwd: source, stdio: 'inherit', shell: true }).status === 0

if (!existsSync(join(source, 'node_modules')) && !run(['ci'])) {
  console.error('[cloud-web] npm ci fallito')
  process.exit(1)
}
rmSync(out, { recursive: true, force: true })
if (!run(['exec', '--', 'vite', 'build', '--outDir', JSON.stringify(out), '--emptyOutDir'])) {
  console.error('[cloud-web] build fallita')
  process.exit(1)
}
console.log(`[cloud-web] pronta: ${out}`)
