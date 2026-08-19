import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, FileText, Loader2, X } from 'lucide-react'

export interface SearchResult {
  file: string
  line: number
  column: number
  preview: string
}

interface GlobalSearchProps {
  rootPath: string
  onOpenResult: (file: string, line: number) => void
}

export function GlobalSearch({ rootPath, onOpenResult }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([])
      setHasSearched(false)
      return
    }
    setIsSearching(true)
    setHasSearched(true)
    try {
      const found = await window.electronAPI.fs.searchFiles(rootPath, q)
      setResults(found)
    } catch {
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [rootPath])

  const handleChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(value), 350)
  }

  const grouped = results.reduce<Map<string, SearchResult[]>>((acc, r) => {
    const list = acc.get(r.file) || []
    list.push(r)
    acc.set(r.file, list)
    return acc
  }, new Map())

  const highlightMatch = (preview: string, q: string) => {
    if (!q) return preview
    const idx = preview.toLowerCase().indexOf(q.toLowerCase())
    if (idx < 0) return preview
    return (
      <>
        {preview.substring(0, idx)}
        <span style={{ color: 'var(--accent-color)', fontWeight: 700, background: 'var(--bg-tag)' }}>
          {preview.substring(idx, idx + q.length)}
        </span>
        {preview.substring(idx + q.length)}
      </>
    )
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-primary)', overflow: 'hidden'
    }}>
      <div style={{
        padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'var(--bg-input)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)', padding: '5px 8px'
        }}>
          <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="search in all files..."
            spellCheck={false}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: 'calc(11px * var(--ui-text-scale, 1))',
              fontFamily: 'var(--font-mono)'
            }}
          />
          {query && (
            <button
              onClick={() => handleChange('')}
              title="clear search" data-tip-desc="clear the search query"
              style={{
                display: 'flex', background: 'none', border: 'none',
                color: 'var(--text-muted)', cursor: 'pointer', padding: 0
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div style={{
          marginTop: '5px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)',
          display: 'flex', justifyContent: 'space-between'
        }}>
          <span>{isSearching ? 'searching...' : hasSearched ? `${results.length} results in ${grouped.size} files` : 'min 2 chars'}</span>
          {isSearching && <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} />}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {!isSearching && hasSearched && results.length === 0 && (
          <div style={{
            padding: '24px 12px', textAlign: 'center',
            color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))'
          }}>
            no results found
          </div>
        )}
        {Array.from(grouped.entries()).map(([file, matches]) => (
          <div key={file} style={{ marginBottom: '2px' }}>
            <div style={{
              padding: '5px 10px', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 600,
              color: 'var(--text-primary)', background: 'var(--bg-subtle)',
              display: 'flex', alignItems: 'center', gap: '5px',
              position: 'sticky', top: 0, borderBottom: '1px solid var(--border-subtle)'
            }}>
              <FileText size={10} style={{ color: 'var(--accent-secondary)', flexShrink: 0 }} />
              <span style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                direction: 'rtl', textAlign: 'left', flex: 1
              }} title={file} data-tip-desc="open this file at the matched position">
                {file.split(/[/\\]/).slice(-3).join('/')}
              </span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, flexShrink: 0 }}>
                {matches.length}
              </span>
            </div>
            {matches.map((m, i) => (
              <div
                key={`${m.file}:${m.line}:${i}`}
                onClick={() => onOpenResult(m.file, m.line)}
                style={{
                  padding: '3px 10px 3px 24px', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
                  fontFamily: 'var(--font-mono)', cursor: 'pointer',
                  display: 'flex', gap: '8px', alignItems: 'baseline',
                  transition: 'background 0.1s ease'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{
                  color: 'var(--accent-secondary)', flexShrink: 0,
                  minWidth: '28px', textAlign: 'right', fontSize: 'calc(9px * var(--ui-text-scale, 1))'
                }}>
                  {m.line}
                </span>
                <span style={{
                  color: 'var(--text-primary)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}>
                  {highlightMatch(m.preview, query)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
