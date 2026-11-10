// Self-check for the translations: every literal key passed to t('…') / tr('…') in src has an
// Italian entry, every placeholder of a key is kept by its translation, no key is built with a
// template literal (use vars: t('{n} files', { n })) and no key gets two different translations
// in two files of src/locales/it/.
// Run: node --experimental-strip-types scripts/i18n.check.ts
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const IT: Record<string, string> = {}
const conflicts: string[] = []
const LOCALES = 'src/locales/it'
for (const name of readdirSync(LOCALES).filter(n => n.endsWith('.ts'))) {
  const part = (await import(pathToFileURL(resolve(LOCALES, name)).href)).IT as Record<string, string>
  for (const [k, v] of Object.entries(part)) {
    if (k in IT && IT[k] !== v) conflicts.push(`${name}: «${k}» → «${v}» vs «${IT[k]}»`)
    IT[k] = v
  }
}

const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !n.endsWith('.d.ts') ? [p] : []
})

const missing: string[] = []
const templated: string[] = []
const keys = new Set<string>()
// t('…') / tr('…') / t("…"), the first argument only; `\b` keeps out set(, split(, at(
const CALL = /\btr?\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(`))/g
// i18n.ts itself only has examples in its comments
for (const file of walk('src').filter(f => !/[\\/]i18n\.ts$/.test(f) && !/[\\/]locales[\\/]/.test(f))) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(CALL)) {
    const line = src.slice(0, m.index).split('\n').length
    if (m[3]) { templated.push(`${file}:${line}`); continue }
    const key = (m[1] ?? m[2]).replace(/\\(['"\\])/g, '$1')
    keys.add(key)
    if (!(key in IT)) missing.push(`${file}:${line}  ${key}`)
  }
}

const lostVars = Object.entries(IT).filter(([k, v]) =>
  (k.match(/\{\w+\}/g) ?? []).some(p => !v.includes(p))).map(([k]) => k)

assert.deepEqual(missing, [], `keys without an Italian translation:\n${missing.join('\n')}`)
assert.deepEqual(templated, [], `template-literal keys (use vars instead):\n${templated.join('\n')}`)
assert.deepEqual(lostVars, [], `translations that drop a placeholder:\n${lostVars.join('\n')}`)
assert.deepEqual(conflicts, [], `keys translated two ways:\n${conflicts.join('\n')}`)
assert.ok(keys.size > 50, 'the scan found the t() calls')
console.log(`i18n: ${keys.size} keys, all translated`)
