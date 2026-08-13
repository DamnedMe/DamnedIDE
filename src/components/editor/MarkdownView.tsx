import { useMemo, ReactNode } from 'react'

// Lightweight, dependency-free Markdown renderer. Produces React elements (no
// dangerouslySetInnerHTML), so untrusted markdown is escaped by React by default.
// Covers the common subset: headings, bold/italic/strike/code/links, fenced code,
// lists, blockquotes, tables and horizontal rules.

interface Block {
  type: 'heading' | 'code' | 'list' | 'quote' | 'table' | 'hr' | 'paragraph'
  level?: number
  items?: string[][] // list items, each item = its lines
  ordered?: boolean
  code?: string
  lang?: string
  lines?: string[]
}

const isFence = (t: string) => /^```/.test(t) || /^~~~/.test(t)

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '') { i++; continue }

    const fence = trimmed.match(/^(```|~~~)(\w*)/)
    if (fence) {
      const lang = fence[2] || ''
      const code: string[] = []
      i++
      while (i < lines.length && !isFence(lines[i].trim())) { code.push(lines[i]); i++ }
      i++
      blocks.push({ type: 'code', code: code.join('\n'), lang })
      continue
    }

    const h = trimmed.match(/^(#{1,6})\s+(.*)/)
    if (h) { blocks.push({ type: 'heading', level: h[1].length, lines: [h[2] || ''] }); i++; continue }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { blocks.push({ type: 'hr' }); i++; continue }

    if (trimmed.startsWith('>')) {
      const quote: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', lines: quote })
      continue
    }

    const isListItem = /^[-*+]\s+/.test(trimmed)
    const isOrdItem = /^\d+\.\s+/.test(trimmed)
    if (isListItem || isOrdItem) {
      const ordered = isOrdItem
      const items: string[][] = []
      const re = isListItem ? /^[-*+]\s+/ : /^\d+\.\s+/
      items.push([trimmed.replace(re, '')])
      i++
      while (i < lines.length) {
        const t = lines[i].trim()
        if (/^[-*+]\s+/.test(t)) { items.push([t.replace(/^[-*+]\s+/, '')]); i++; continue }
        if (/^\d+\.\s+/.test(t)) { items.push([t.replace(/^\d+\.\s+/, '')]); i++; continue }
        if (t === '' || /^#{1,6}\s/.test(t) || isFence(t) || t.startsWith('>') || /^(-{3,})$/.test(t)) break
        items[items.length - 1].push(t)
        i++
      }
      blocks.push({ type: 'list', items, ordered })
      continue
    }

    if (trimmed.startsWith('|') && /^\|.*\|$/.test(trimmed)) {
      const parseRow = (s: string) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
      const rows: string[][] = [parseRow(trimmed)]
      i++
      if (i < lines.length && /^\|[\s:|-]+\|$/.test(lines[i].trim())) i++
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { rows.push(parseRow(lines[i].trim())); i++ }
      blocks.push({ type: 'table', lines: rows.map(r => r.join('|')) })
      continue
    }

    const para: string[] = [line]
    i++
    while (i < lines.length) {
      const t = lines[i]
      const tt = t.trim()
      if (tt === '' || /^#{1,6}\s/.test(tt) || isFence(tt) || tt.startsWith('>') || /^[-*+]\s+/.test(tt) || /^\d+\.\s+/.test(tt) || /^(-{3,})$/.test(tt) || (tt.startsWith('|') && /^\|.*\|$/.test(tt))) break
      para.push(t)
      i++
    }
    blocks.push({ type: 'paragraph', lines: para })
  }
  return blocks
}

const LINK_RE = /(\*\*(.+?)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))|(~~(.+?)~~)/

function safeHref(href: string): string {
  const h = href.trim()
  if (/^(https?:|mailto:|#|\/)/i.test(h)) return h
  return '#'
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  // protect inline code spans first
  const parts = text.split(/(`[^`]+`)/g)
  const out: ReactNode[] = []
  parts.forEach((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      out.push(<code key={`${keyBase}-c${i}`}>{part.slice(1, -1)}</code>)
    } else if (part) {
      out.push(...renderInlineSimple(part, `${keyBase}-${i}`))
    }
  })
  return out
}

function renderInlineSimple(text: string, keyBase: string): ReactNode[] {
  const m = text.match(LINK_RE)
  if (!m) return [text]
  const idx = m.index ?? 0
  const before = text.slice(0, idx)
  const rest = text.slice(idx + m[0].length)
  let node: ReactNode
  if (m[0].startsWith('**')) node = <strong key={`${keyBase}-b`}>{renderInlineSimple(m[2] ?? '', keyBase)}</strong>
  else if (m[0].startsWith('*')) node = <em key={`${keyBase}-e`}>{renderInlineSimple(m[4] ?? '', keyBase)}</em>
  else if (m[0].startsWith('[')) node = <a key={`${keyBase}-a`} href={safeHref(m[7] ?? '')} target="_blank" rel="noreferrer">{renderInlineSimple(m[6] ?? '', keyBase)}</a>
  else node = <del key={`${keyBase}-s`}>{renderInlineSimple(m[9] ?? '', keyBase)}</del>
  return [before, node, ...renderInlineSimple(rest, keyBase)]
}

export function MarkdownView({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content])

  return (
    <div className="md-view" style={{
      height: '100%', overflow: 'auto', padding: '18px 24px',
      fontFamily: "'Segoe UI', 'Cascadia Code', 'Segoe UI Emoji', sans-serif",
      fontSize: 'calc(13px * var(--ui-text-scale, 1))',
      color: 'var(--text-primary)', lineHeight: 1.65,
      background: 'var(--bg-card)'
    }}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading': {
            const Tag = `h${b.level || 2}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
            return <Tag key={i}>{renderInline((b.lines?.[0] || ''), `h${i}`)}</Tag>
          }
          case 'code':
            return (
              <pre key={i}><code className={b.lang ? `lang-${b.lang}` : ''}>{b.code}</code></pre>
            )
          case 'hr':
            return <hr key={i} />
          case 'quote':
            return (
              <blockquote key={i}>
                {b.lines?.map((l, j) => <p key={j}>{renderInline(l, `q${i}-${j}`)}</p>)}
              </blockquote>
            )
          case 'list':
            return b.ordered ? (
              <ol key={i}>
                {b.items?.map((item, j) => (
                  <li key={j}>{item.map((l, k) => <span key={k}>{renderInline(l, `li${i}-${j}-${k}`)}</span>)}</li>
                ))}
              </ol>
            ) : (
              <ul key={i}>
                {b.items?.map((item, j) => (
                  <li key={j}>{item.map((l, k) => <span key={k}>{renderInline(l, `li${i}-${j}-${k}`)}</span>)}</li>
                ))}
              </ul>
            )
          case 'table': {
            const rows = (b.lines || []).map(r => r.split('|'))
            const header = rows[0] || []
            const body = rows.slice(1)
            return (
              <table key={i}>
                <thead><tr>{header.map((c, j) => <th key={j}>{renderInline(c, `th${i}-${j}`)}</th>)}</tr></thead>
                <tbody>
                  {body.map((r, j) => (
                    <tr key={j}>{r.map((c, k) => <td key={k}>{renderInline(c, `td${i}-${j}-${k}`)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            )
          }
          default:
            return <p key={i}>{b.lines?.map((l, j) => <span key={j}>{renderInline(l, `p${i}-${j}`)}</span>)}</p>
        }
      })}
      {blocks.length === 0 && <p style={{ color: 'var(--text-muted)' }}>(empty document)</p>}
    </div>
  )
}
