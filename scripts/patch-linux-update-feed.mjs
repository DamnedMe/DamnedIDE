// Adds the .pacman artifact to latest-linux.yml so electron-updater's
// PacmanUpdater can download it (electron-builder 24 publishes deb/AppImage in
// the feed but not the pacman package). Used by the release workflow after the
// pacman build; --tag also re-uploads the patched feed with `gh`.
//
// Usage: node scripts/patch-linux-update-feed.mjs --dir dist --tag v0.0.19
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Inserts or replaces the pacman entry in a latest-linux.yml body. */
export function withPacmanEntry(yaml, entry) {
  const lines = String(yaml).split(/\r?\n/)
  const fileLine = `  - url: ${entry.url}`
  const entryLines = [fileLine, `    sha512: ${entry.sha512}`, `    size: ${entry.size}`]
  const existing = lines.findIndex(line => /^\s*-\s+url:\s*.*\.pacman\s*$/.test(line))
  if (existing >= 0) {
    let end = existing + 1
    while (end < lines.length && /^\s{4}\S/.test(lines[end])) end++
    lines.splice(existing, end - existing, ...entryLines)
    return lines.join('\n')
  }
  // append after the last file entry (the block is a list under `files:`)
  let lastFile = -1
  let end = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s+url:\s/.test(lines[i])) {
      lastFile = i
      end = i + 1
      while (end < lines.length && /^\s{4}\S/.test(lines[end])) end++
      i = end - 1
    }
  }
  if (lastFile < 0) throw new Error('latest-linux.yml: nessuna voce files: trovata')
  lines.splice(end, 0, ...entryLines)
  return lines.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  const dir = resolve(args[args.indexOf('--dir') + 1] || 'dist')
  const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : null
  const feedPath = join(dir, 'latest-linux.yml')
  if (!existsSync(feedPath)) throw new Error(`feed non trovato: ${feedPath}`)
  const pacman = readdirSync(dir).filter(name => name.toLowerCase().endsWith('.pacman'))
  if (pacman.length !== 1) throw new Error(`atteso un solo .pacman in ${dir}, trovati: ${pacman.join(', ') || 'nessuno'}`)
  const file = join(dir, pacman[0])
  const buf = readFileSync(file)
  const patched = withPacmanEntry(readFileSync(feedPath, 'utf-8'), {
    url: pacman[0],
    sha512: createHash('sha512').update(buf).digest('base64'),
    size: statSync(file).size
  })
  writeFileSync(feedPath, patched)
  console.log(`feed aggiornato con ${pacman[0]} (${statSync(file).size} byte)`)
  if (tag) {
    execFileSync('gh', ['release', 'upload', tag, feedPath, '--clobber'], { stdio: 'inherit' })
    console.log(`latest-linux.yml ripubblicato sulla release ${tag}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
