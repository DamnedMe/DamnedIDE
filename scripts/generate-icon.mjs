// Genera resources/icon.ico (16,32,48,64,128,256) e resources/icon.png (512)
// dal logo (PNG se presente, altrimenti SVG). Esegui: node scripts/generate-icon.mjs
import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources')

// prefer the PNG logo, fall back to the SVG
let source
for (const candidate of ['src/assets/logo.png', 'src/assets/intend-logo.svg']) {
  try { await stat(join(root, candidate)); source = join(root, candidate); break } catch { /* next */ }
}
if (!source) {
  console.error('Nessun logo trovato (logo.png / intend-logo.svg)')
  process.exit(1)
}
console.log('Fonte logo:', source)

await mkdir(outDir, { recursive: true })

const sizes = [16, 32, 48, 64, 128, 256]

// PNG entries for the ICO (Vista+ supports PNG-compressed icons)
const pngs = []
for (const size of sizes) {
  const buf = await sharp(source).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  pngs.push({ size, buf })
}

// Assemble the ICO container (ICONDIR + ICONDIRENTRY + PNG data)
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(pngs.length, 4)

const entries = Buffer.alloc(16 * pngs.length)
const images = []
let offset = 6 + entries.length
for (let i = 0; i < pngs.length; i++) {
  const { size, buf } = pngs[i]
  const e = i * 16
  entries.writeUInt8(size === 256 ? 0 : size, e) // width
  entries.writeUInt8(size === 256 ? 0 : size, e + 1) // height
  entries.writeUInt8(0, e + 2) // palette
  entries.writeUInt8(0, e + 3) // reserved
  entries.writeUInt16LE(1, e + 4) // planes
  entries.writeUInt16LE(32, e + 6) // bpp
  entries.writeUInt32LE(buf.length, e + 8)
  entries.writeUInt32LE(offset, e + 12)
  offset += buf.length
  images.push(buf)
}
const ico = Buffer.concat([header, entries, ...images])
await writeFile(join(outDir, 'icon.ico'), ico)

// 512px PNG for linux/mac + electron-builder fallback
const png512 = await sharp(source).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
await writeFile(join(outDir, 'icon.png'), png512)

console.log('OK: resources/icon.ico', ico.length, 'bytes; resources/icon.png', png512.length, 'bytes')
