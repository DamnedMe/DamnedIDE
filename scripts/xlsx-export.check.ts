// Verifica il writer XLSX: struttura ZIP, parti OOXML e tipi cella.
// Esegui: node --experimental-strip-types scripts/xlsx-export.check.ts
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { buildXlsx, columnLetter, sanitizeSheetName } from '../electron/services/export/xlsx.service.ts'

// ─── minimal ZIP reader (only what this writer produces) ─────────────────────
function readZip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0, 'EOCD presente')
  const count = buf.readUInt16LE(end + 10)
  let offset = buf.readUInt32LE(end + 16)
  const out = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(offset), 0x02014b50, 'central directory signature')
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const nameLength = buf.readUInt16LE(offset + 28)
    const extraLength = buf.readUInt16LE(offset + 30)
    const commentLength = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.slice(offset + 46, offset + 46 + nameLength).toString('utf8')

    assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, 'local header signature')
    const localNameLength = buf.readUInt16LE(localOffset + 26)
    const localExtraLength = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const data = buf.slice(dataStart, dataStart + compressedSize)
    out.set(name, method === 8 ? inflateRawSync(data) : data)
    offset += 46 + nameLength + extraLength + commentLength
  }
  return out
}

// ─── helpers ─────────────────────────────────────────────────────────────────
assert.equal(columnLetter(0), 'A')
assert.equal(columnLetter(25), 'Z')
assert.equal(columnLetter(26), 'AA')
assert.equal(columnLetter(701), 'ZZ')
assert.equal(sanitizeSheetName('bad/name[with]:chars'), 'bad_name_with__chars')
assert.equal(sanitizeSheetName('x'.repeat(50)).length, 31)

const xlsx = buildXlsx({
  name: 'Massive Rows',
  columns: ['Id', 'Code', 'Amount', 'IsActive', 'Notes'],
  rows: [
    [1, 'ROW-1 & <2>', 17.31, true, null],
    [2, 'ROW-2 "quoted"', -5, false, 'ok']
  ]
})

const parts = readZip(xlsx)
for (const required of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
  assert.ok(parts.has(required), `parte presente: ${required}`)
}

const workbook = parts.get('xl/workbook.xml')!.toString('utf8')
assert.match(workbook, /<sheet name="Massive Rows" sheetId="1" r:id="rId1"\/>/)

const sheet = parts.get('xl/worksheets/sheet1.xml')!.toString('utf8')
// header in bold (style index 1) and frozen pane
assert.match(sheet, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Id<\/t><\/is><\/c>/)
assert.match(sheet, /state="frozen"/)
// numbers stay numbers, booleans are t="b", booleans and nulls do not become strings
assert.match(sheet, /<c r="A2"><v>1<\/v><\/c>/)
assert.match(sheet, /<c r="C2"><v>17.31<\/v><\/c>/)
assert.match(sheet, /<c r="D2" t="b"><v>1<\/v><\/c>/)
assert.match(sheet, /<c r="D3" t="b"><v>0<\/v><\/c>/)
assert.doesNotMatch(sheet, /r="E2"/) // null cell is omitted
// XML escaping
assert.match(sheet, /ROW-1 &amp; &lt;2&gt;/)
assert.match(sheet, /ROW-2 &quot;quoted&quot;/)

console.log('ok — xlsx export')
