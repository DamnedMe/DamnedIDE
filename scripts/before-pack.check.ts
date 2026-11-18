import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { addElectronPrebuilds } = createRequire(import.meta.url)('./before-pack.cjs')

const root = mkdtempSync(join(tmpdir(), 'pty-prebuilds-'))
const x64 = join(root, 'prebuilds', 'linux-x64')
mkdirSync(x64, { recursive: true })
for (const f of ['node.abi115.node', 'node.abi99.node', 'node.abi115.musl.node']) writeFileSync(join(x64, f), f)
mkdirSync(join(root, 'prebuilds', 'linux-arm64'))
writeFileSync(join(root, 'prebuilds', 'linux-arm64', 'node.abi120.node'), 'arm')

assert.deepEqual(addElectronPrebuilds(119, root).sort(), ['linux-arm64/electron.abi119.node', 'linux-x64/electron.abi119.musl.node', 'linux-x64/electron.abi119.node'])
assert.equal(readFileSync(join(x64, 'electron.abi119.node'), 'utf8'), 'node.abi115.node', 'highest ABI, glibc')
assert.equal(readFileSync(join(x64, 'electron.abi119.musl.node'), 'utf8'), 'node.abi115.musl.node', 'musl from musl')
assert.deepEqual(addElectronPrebuilds(119, root), [], 'idempotent')
assert.deepEqual(addElectronPrebuilds(119, join(root, 'missing')), [], 'no prebuilds dir')
assert.equal(readdirSync(x64).length, 5)

// the real package: the Linux binaries node-pty ships
const real = addElectronPrebuilds(119)
console.log('before-pack: ok', real.length ? `(wrote ${real.join(', ')})` : '(already present)')
