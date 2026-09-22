'use strict'
const { mkdirSync, writeFileSync } = require('fs')
const { join } = require('path')

/**
 * electron-builder afterPack hook.
 *
 * electron-updater chooses its Linux updater from `resources/package-type`
 * (appimage/deb/rpm/pacman). electron-builder writes that file only for the
 * deb/rpm targets, and every target built in the same run shares the same
 * `linux-unpacked` directory: building `AppImage deb pacman` in one pass left
 * the pacman package labelled as `deb`, so Arch users got the Debian updater.
 *
 * The release workflow therefore builds pacman in a second, dedicated run with
 * DAMNED_PACKAGE_TYPE=pacman; this hook writes the label after packaging.
 */
module.exports = async function afterPack(context) {
  const type = process.env.DAMNED_PACKAGE_TYPE
  if (!type) return
  if (context.electronPlatformName !== 'linux') return
  const resources = join(context.appOutDir, 'resources')
  mkdirSync(resources, { recursive: true })
  const file = join(resources, 'package-type')
  writeFileSync(file, type)
  console.log(`  • package-type written  file=${file} value=${type}`)
}
