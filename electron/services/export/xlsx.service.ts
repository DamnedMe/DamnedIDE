import { deflateRawSync } from 'zlib'

// Minimal, dependency-free XLSX writer (Office Open XML = a ZIP of XML parts).
// Only what a query result needs: one sheet, inline strings, numbers, booleans,
// a bold header row, a frozen header and an autofilter. Written in the main
// process, so the renderer stays free of heavy spreadsheet libraries.

export type XlsxCell = string | number | boolean | null
export interface XlsxSheet {
  name: string
  columns: string[]
  rows: XlsxCell[][]
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** Excel sheet names: 31 chars max, no []:*?/\ and no leading/trailing quote. */
export function sanitizeSheetName(name: string): string {
  const clean = (name || 'Results').replace(/[\\/?*[\]:]/g, '_').replace(/^'+|'+$/g, '').trim()
  return (clean || 'Results').slice(0, 31)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // control chars are illegal in XML 1.0
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

/** A, B, ... Z, AA, AB ... */
export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function cellXml(ref: string, value: XlsxCell, styleIndex?: number): string {
  const s = styleIndex ? ` s="${styleIndex}"` : ''
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`
  if (typeof value === 'boolean') return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`
  const text = String(value)
  if (text === '') return ''
  // Excel hard limit per cell
  const clipped = text.length > 32767 ? `${text.slice(0, 32760)}…` : text
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(clipped)}</t></is></c>`
}

function sheetXml(sheet: XlsxSheet): string {
  const lastColumn = columnLetter(Math.max(0, sheet.columns.length - 1))
  const rows: string[] = []
  if (sheet.columns.length > 0) {
    const header = sheet.columns.map((column, i) => cellXml(`${columnLetter(i)}1`, column, 1)).join('')
    rows.push(`<row r="1">${header}</row>`)
  }
  for (let r = 0; r < sheet.rows.length; r++) {
    const values = sheet.rows[r] || []
    const cells = values.map((value, i) => cellXml(`${columnLetter(i)}${r + 2}`, value)).join('')
    rows.push(`<row r="${r + 2}">${cells}</row>`)
  }
  const headerRef = sheet.columns.length > 0 ? `A1:${lastColumn}1` : 'A1:A1'
  return `${XML_HEADER}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<sheetData>${rows.join('')}</sheetData>
<autoFilter ref="${headerRef}"/>
</worksheet>`
}

function workbookXml(sheetName: string): string {
  return `${XML_HEADER}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
}

const STYLES_XML = `${XML_HEADER}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`

const CONTENT_TYPES = `${XML_HEADER}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

const ROOT_RELS = `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const WORKBOOK_RELS = `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

// ─── ZIP container ───────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

interface ZipEntry {
  name: string
  data: Buffer
}

function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  // fixed DOS timestamp: Excel does not care, and a deterministic file is easier
  // to verify in tests
  const dosTime = 0
  const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data)
    const useDeflate = compressed.length < entry.data.length
    const payload = useDeflate ? compressed : entry.data
    const method = useDeflate ? 8 : 0
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    locals.push(local, name, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8) // flags
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + payload.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuf, end])
}

export function buildXlsx(sheet: XlsxSheet): Buffer {
  const name = sanitizeSheetName(sheet.name)
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml(name), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WORKBOOK_RELS, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES_XML, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml({ ...sheet, name }), 'utf8') }
  ])
}
