import { useEffect, useState } from 'react'
import { AdoWorkItem } from '../../types/ado'
import { Bug, Bookmark, Shield, Wrench, Search, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'

interface WorkItemListProps {
  workItems: AdoWorkItem[]
  onSelect: (id: number) => void
  selectedId: number | null
}

const PAGE_SIZE = 10

const typeIcons: Record<string, React.ReactNode> = {
  Bug: <Bug size={13} />,
  'User Story': <Bookmark size={13} />,
  Task: <Wrench size={13} />,
  Feature: <Shield size={13} />
}

const typeColors: Record<string, string> = {
  Bug: '#e81123',
  'User Story': '#009ccc',
  Task: '#f2cb1d',
  Feature: '#773b93'
}

export function WorkItemList({ workItems, onSelect, selectedId }: WorkItemListProps) {
  const [search, setSearch] = useState('')
  const [sortAsc, setSortAsc] = useState(false)
  const [page, setPage] = useState(0)

  const filtered = workItems.filter(wi => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return wi.title.toLowerCase().includes(q) || String(wi.id).includes(q)
  })
  const sorted = [...filtered].sort((a, b) => sortAsc ? a.id - b.id : b.id - a.id)
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const paged = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  useEffect(() => setPage(0), [search, sortAsc])

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden', minHeight: 0
    }}>
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid var(--border-color)',
        fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-secondary)',
        textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-mono)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
      }}>
        <span>Work Items ({workItems.length})</span>
        <button onClick={() => setSortAsc(!sortAsc)} title="sort by id"
          style={{
            display: 'flex', alignItems: 'center', gap: '3px', background: 'none',
            border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
          <ArrowUpDown size={10} /> id {sortAsc ? 'asc' : 'desc'}
        </button>
      </div>
      <div style={{
        padding: '5px 10px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          background: 'var(--bg-input)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)', padding: '3px 7px'
        }}>
          <Search size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="search id / title..."
            spellCheck={false}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
            }}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {paged.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            no work items
          </div>
        ) : paged.map((wi) => (
          <div
            key={wi.id}
            onClick={() => onSelect(wi.id)}
            style={{
              display: 'flex', alignItems: 'center', padding: '6px 10px',
              borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
              background: selectedId === wi.id ? 'var(--accent-bg)' : 'transparent',
              borderLeft: selectedId === wi.id ? '3px solid var(--accent-color)' : '3px solid transparent',
              gap: '8px'
            }}
            onMouseEnter={(e) => { if (selectedId !== wi.id) e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { if (selectedId !== wi.id) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ color: typeColors[wi.type] || 'var(--text-secondary)', display: 'flex' }}>
              {typeIcons[wi.type] || <Bookmark size={13} />}
            </span>
            <span style={{
              flex: 1, fontSize: 'calc(11px * var(--ui-text-scale, 1))', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', color: 'var(--text-primary)'
            }}>
              #{wi.id}: {wi.title}
            </span>
            <span style={{
              fontSize: 'calc(9px * var(--ui-text-scale, 1))', padding: '1px 6px', background: 'var(--bg-tag)',
              borderRadius: '3px', color: 'var(--text-secondary)', flexShrink: 0
            }}>
              {wi.state}
            </span>
          </div>
        ))}
      </div>
      {sorted.length > PAGE_SIZE && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '5px 10px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0
        }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '20px', background: 'var(--bg-card)',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
              color: safePage === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
              cursor: safePage === 0 ? 'not-allowed' : 'pointer'
            }}>
            <ChevronLeft size={10} />
          </button>
          <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            {safePage + 1} / {pageCount}
          </span>
          <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '20px', background: 'var(--bg-card)',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
              color: safePage >= pageCount - 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
              cursor: safePage >= pageCount - 1 ? 'not-allowed' : 'pointer'
            }}>
            <ChevronRight size={10} />
          </button>
        </div>
      )}
    </div>
  )
}
