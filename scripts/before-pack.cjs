'use strict'
const { copyFileSync, existsSync, readdirSync } = require('fs')
const { join } = require('path')

const PTY = join(__dirname, '..', 'node_modules', '@homebridge', 'node-pty-prebuilt-multiarch')

/**
 * Gives node-pty a binary under the name it looks for inside Electron; returns the files written.
 *
 * Under Electron, node-pty loads `prebuilds/<platform>-<arch>/electron.abi<N>.node`, else falls back to
 * `build/Release/pty.node`. Its Linux prebuilds ship only as `node.abi*.node`, and on Linux `npm ci`
 * finds one and builds nothing: the packaged IDE found no binary and died before opening a window.
 * The binaries are N-API (ABI-independent): the same file serves Electron under its own name.
 */
function addElectronPrebuilds(abi, root = PTY) {
  const prebuilds = join(root, 'prebuilds')
  if (!existsSync(prebuilds)) return []
  const written = []
  for (const dir of readdirSync(prebuilds)) {
    const files = readdirSync(join(prebuilds, dir))
    for (const musl of ['', '.musl']) {
      const target = `electron.abi${abi}${musl}.node`
      // any node.abi*.node will do (N-API); take the highest ABI
      const source = files
        .filter((f) => new RegExp(`^node\\.abi\\d+${musl.replace('.', '\\.')}\\.node$`).test(f))
        .sort((a, b) => parseInt(b.slice(8), 10) - parseInt(a.slice(8), 10))[0]
      if (!source || files.includes(target)) continue
      copyFileSync(join(prebuilds, dir, source), join(prebuilds, dir, target))
      written.push(`${dir}/${target}`)
    }
  }
  return written
}

/** electron-builder beforePack hook: runs before app.asar is written, so the files land in its index. */
module.exports = async function beforePack() {
  const abi = require('node-abi').getAbi(require('electron/package.json').version, 'electron')
  for (const file of addElectronPrebuilds(abi)) console.log(`  • node-pty prebuild for Electron  file=${file}`)
}
module.exports.addElectronPrebuilds = addElectronPrebuilds
