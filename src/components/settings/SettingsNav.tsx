import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Bot, Cloud, FolderGit2, GitBranch, Languages, Palette, PenLine, PlugZap, RefreshCw, Rocket,
  RotateCcw, Search, Smartphone, Sun, TerminalSquare, Type, X
} from '@/components/icons'
import type { AppIcon } from '@/components/icons'
import type { SettingsPageId } from '../../store'
import { px } from './ui'

export interface SettingsGroup {
  id: string
  label: string
}

export interface SettingsPageMeta {
  id: SettingsPageId
  group: string
  label: string
  /** one line under the page title */
  description: string
  /** extra words the search matches (Italian and English) */
  keywords: string
  icon: AppIcon
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: 'general', label: 'Generale' },
  { id: 'appearance', label: 'Aspetto' },
  { id: 'editor', label: 'Editor' },
  { id: 'terminal', label: 'Terminale' },
  { id: 'git', label: 'Git' },
  { id: 'ado', label: 'Azure DevOps' },
  { id: 'ai', label: 'AI' },
  { id: 'devices', label: 'Dispositivi' }
]

export const SETTINGS_PAGE_META: SettingsPageMeta[] = [
  {
    id: 'updates', group: 'general', label: 'Aggiornamenti', icon: RefreshCw,
    description: 'versione installata e aggiornamenti automatici da GitHub',
    keywords: 'aggiornamenti versione ota update updates installa scarica release github riavvia'
  },
  {
    id: 'language', group: 'general', label: 'Lingua', icon: Languages,
    description: "lingua dell'interfaccia dell'IDE",
    keywords: 'lingua language italiano english inglese traduzione'
  },
  {
    id: 'theme', group: 'appearance', label: 'Tema', icon: Sun,
    description: 'tema scuro o chiaro, colore primario e tema standard',
    keywords: 'tema theme scuro chiaro dark light colore primario accento accent standard'
  },
  {
    id: 'text', group: 'appearance', label: 'Testo e icone', icon: Type,
    description: "dimensione del testo e delle icone, font dell'interfaccia",
    keywords: 'testo text font dimensione size carattere icone icon interfaccia famiglia family google fonts'
  },
  {
    id: 'colors', group: 'appearance', label: 'Colori', icon: Palette,
    description: "colori della sintassi nell'editor, per il tema attivo",
    keywords: 'colori colors sintassi syntax editor keyword parole chiave stringhe commenti tipi metodi palette'
  },
  {
    id: 'editor', group: 'editor', label: 'Editor', icon: PenLine,
    description: "comportamento dell'editor di codice",
    keywords: 'editor minimap tab spazi indentazione numeri di riga line numbers a capo word wrap legature ligatures salvataggio automatico auto save scorciatoie navigazione keybindings'
  },
  {
    id: 'terminal', group: 'terminal', label: 'Terminale', icon: TerminalSquare,
    description: 'dimensione del testo dei terminali integrati',
    keywords: 'terminale terminal console font dimensione size zoom ctrl rotellina xterm'
  },
  {
    id: 'git', group: 'git', label: 'Git', icon: GitBranch,
    description: 'client GitTree aperto dalla voce Git e lista delle modifiche',
    // no « path »: words match by prefix, « pat » must find only the PAT page
    keywords: 'git gittree client eseguibile executable percorso scarica download changes modifiche file nome cartella folder gruppi raggruppa tipologia worktree'
  },
  {
    id: 'ado-connections', group: 'ado', label: 'Connessioni', icon: Cloud,
    description: 'organization, project e PAT di Azure DevOps',
    keywords: 'azure devops ado connessioni connection organization organizzazione project progetto pat token personal access'
  },
  {
    id: 'ado-folders', group: 'ado', label: 'Repository per cartella', icon: FolderGit2,
    description: 'quale repository Azure DevOps usa ogni cartella aperta',
    keywords: 'azure devops ado cartella cartelle folder repository repo mappatura worktree associazione'
  },
  {
    id: 'ado-release', group: 'ado', label: 'Rilascio', icon: Rocket,
    description: 'repository BE e FE promosse dal pannello Rilascio',
    keywords: 'azure devops ado rilascio release promozione promote be fe backend frontend dev qa prod'
  },
  {
    id: 'ai-agents', group: 'ai', label: 'Agenti', icon: Bot,
    description: 'agenti AI della chat: accesso, verifica e modello',
    keywords: 'ai agenti agents claude codex cursor opencode api key login modello model chat'
  },
  {
    id: 'ai-mcp', group: 'ai', label: 'Server MCP', icon: PlugZap,
    description: 'server di strumenti MCP (stdio) usati dagli agenti',
    keywords: 'mcp server strumenti tools stdio plugin'
  },
  {
    id: 'remote', group: 'devices', label: 'Accesso remoto', icon: Smartphone,
    description: "DamnedCloud: associa un telefono e controlla l'IDE da remoto",
    keywords: 'remoto remote dispositivi devices telefono phone mobile damnedcloud qr tailscale associa pairing'
  }
]

export function pageMeta(id: SettingsPageId): SettingsPageMeta {
  return SETTINGS_PAGE_META.find(p => p.id === id) ?? SETTINGS_PAGE_META[0]
}

export function groupLabel(id: string): string {
  return SETTINGS_GROUPS.find(g => g.id === id)?.label ?? ''
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Pages where every word of the query starts a word of the label, group,
 * description or keywords (« pat » finds the PAT page, not « mappatura »).
 */
export function filterPages(query: string): SettingsPageMeta[] {
  const words = fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (words.length === 0) return SETTINGS_PAGE_META
  return SETTINGS_PAGE_META.filter(p => {
    const hay = fold(`${p.label} ${groupLabel(p.group)} ${p.description} ${p.keywords}`).split(/[^\p{L}\p{N}]+/u)
    return words.every(w => hay.some(h => h.startsWith(w)))
  })
}

interface NavProps {
  page: SettingsPageId
  onSelect: (page: SettingsPageId) => void
  query: string
  onQuery: (q: string) => void
  onReset: () => void
  /** small dot next to a page (update ready, connection without PAT) */
  badges: Partial<Record<SettingsPageId, { tone: 'accent' | 'warning'; tip: string }>>
  /** under ~640px: search + a horizontal strip of pages above the content */
  compact: boolean
}

export function SettingsNav({ page, onSelect, query, onQuery, onReset, badges, compact }: NavProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const pages = filterPages(query)

  // the active page stays visible (also when another panel opened it): only the
  // list scrolls, scrollIntoView could move the overflow-hidden panel ancestors too
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>(`[data-page="${page}"]`)
    if (!list || !el) return
    const pad = 8
    if (compact) {
      if (el.offsetLeft < list.scrollLeft) list.scrollLeft = el.offsetLeft - pad
      else if (el.offsetLeft + el.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = el.offsetLeft + el.offsetWidth - list.clientWidth + pad
    } else {
      if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop - pad
      else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + pad
    }
  }, [page, compact])

  const focusPage = (id: SettingsPageId) => {
    listRef.current?.querySelector<HTMLElement>(`[data-page="${id}"]`)?.focus()
  }

  // arrows move between the visible pages (and open them), Home/End jump
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const keysPrev = compact ? ['ArrowLeft', 'ArrowUp'] : ['ArrowUp']
    const keysNext = compact ? ['ArrowRight', 'ArrowDown'] : ['ArrowDown']
    if (pages.length === 0) return
    const i = Math.max(0, pages.findIndex(p => p.id === page))
    let next: SettingsPageMeta | undefined
    if (keysPrev.includes(e.key)) next = pages[Math.max(0, i - 1)]
    else if (keysNext.includes(e.key)) next = pages[Math.min(pages.length - 1, i + 1)]
    else if (e.key === 'Home') next = pages[0]
    else if (e.key === 'End') next = pages[pages.length - 1]
    if (!next) return
    e.preventDefault()
    onSelect(next.id)
    focusPage(next.id)
  }

  const search = (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: compact ? '1 1 auto' : undefined, minWidth: 0 }}>
      {/* app icons are scaled with CSS zoom (--icon-zoom): the wrapper keeps the offset unzoomed */}
      <span style={{ position: 'absolute', left: '8px', display: 'flex', color: 'var(--text-muted)', pointerEvents: 'none' }}>
        <Search size={12} />
      </span>
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); onQuery('') }
          if (e.key === 'Enter' && pages[0]) { onSelect(pages[0].id); focusPage(pages[0].id) }
          if (e.key === 'ArrowDown' && pages[0]) { e.preventDefault(); onSelect(pages[0].id); focusPage(pages[0].id) }
        }}
        placeholder="cerca nelle impostazioni"
        aria-label="cerca nelle impostazioni"
        spellCheck={false}
        title="cerca una pagina delle impostazioni"
        data-tip-desc="filtra le pagine per nome e parole chiave (es. pat, font, worktree); Invio apre la prima"
        style={{
          width: '100%', minHeight: px(28),
          padding: '0 calc(11px * var(--icon-zoom, 1) + 14px) 0 calc(12px * var(--icon-zoom, 1) + 14px)',
          background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)', fontSize: px(10.5), fontFamily: 'var(--font-mono)', outline: 'none'
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-color)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)' }}
      />
      {query && (
        <button onClick={() => onQuery('')} title="cancella la ricerca" data-tip-desc="mostra di nuovo tutte le pagine"
          style={{ position: 'absolute', right: '4px', display: 'flex', padding: '3px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <X size={11} />
        </button>
      )}
    </div>
  )

  const item = (p: SettingsPageMeta) => {
    const active = p.id === page
    const Icon = p.icon
    const badge = badges[p.id]
    const edge = compact ? `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}` : '1px solid transparent'
    return (
      <button
        key={p.id}
        data-page={p.id}
        onClick={() => onSelect(p.id)}
        aria-current={active ? 'page' : undefined}
        tabIndex={active || (!pages.some(x => x.id === page) && p.id === pages[0]?.id) ? 0 : -1}
        title={p.label}
        data-tip-desc={p.description}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
          width: compact ? 'auto' : '100%', textAlign: 'left',
          padding: compact ? '0 10px' : '0 10px 0 8px', minHeight: px(compact ? 26 : 28),
          borderRadius: compact ? '999px' : 'var(--radius-sm)',
          // longhands only: the shorthand + borderLeft mix breaks when compact toggles
          borderTop: edge, borderRight: edge, borderBottom: edge,
          borderLeft: compact ? edge : `2px solid ${active ? 'var(--accent-color)' : 'transparent'}`,
          background: active ? 'var(--accent-bg)' : 'transparent',
          color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
          fontSize: px(10.5), fontFamily: 'var(--font-mono)', fontWeight: active ? 700 : 500,
          cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.12s ease, color 0.12s ease'
        }}
        onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' } }}
        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
      >
        <Icon size={13} style={{ flexShrink: 0, opacity: active ? 1 : 0.85 }} />
        <span style={{ flex: compact ? undefined : 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</span>
        {badge && (
          <span aria-label={badge.tip} title={badge.tip} style={{
            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
            background: badge.tone === 'warning' ? 'var(--warning-color)' : 'var(--accent-color)'
          }} />
        )}
      </button>
    )
  }

  const resetBtn = (
    <button onClick={onReset}
      title="ripristina predefiniti"
      data-tip-desc="riporta tema, colori, testo, editor, terminale, lingua, GitTree e lista changes ai valori iniziali (chiede conferma; Azure DevOps, agenti e dispositivi non cambiano)"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexShrink: 0,
        width: compact ? undefined : '100%', padding: compact ? '0 8px' : '0 10px', minHeight: px(28),
        background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
        color: 'var(--text-muted)', cursor: 'pointer', fontSize: px(10), fontFamily: 'var(--font-mono)', fontWeight: 600
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--error-color)'; e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.background = 'var(--error-bg)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}>
      <RotateCcw size={11} />
      {!compact && 'ripristina predefiniti'}
    </button>
  )

  const empty = (
    <div style={{ padding: compact ? '4px 2px' : '14px 10px', color: 'var(--text-muted)', fontSize: px(10), fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
      nessuna pagina per «{query.trim()}»
    </div>
  )

  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px 8px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-sidebar)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {search}
          {resetBtn}
        </div>
        <div ref={listRef} role="navigation" aria-label="pagine delle impostazioni" onKeyDown={onListKey}
          style={{ position: 'relative', display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '2px' }}>
          {pages.length === 0 ? empty : pages.map(item)}
        </div>
      </div>
    )
  }

  return (
    <aside style={{
      width: 'clamp(190px, calc(200px * var(--ui-text-scale, 1)), 300px)', flexShrink: 0,
      display: 'flex', flexDirection: 'column', minHeight: 0,
      background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-color)'
    }}>
      <div style={{ padding: '12px 10px 8px', flexShrink: 0 }}>{search}</div>
      <div ref={listRef} role="navigation" aria-label="pagine delle impostazioni" onKeyDown={onListKey}
        style={{ position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 10px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {pages.length === 0 && empty}
        {SETTINGS_GROUPS.map(g => {
          const inGroup = pages.filter(p => p.group === g.id)
          if (inGroup.length === 0) return null
          return (
            <div key={g.id} role="group" aria-label={g.label} style={{ display: 'flex', flexDirection: 'column', gap: '1px', paddingTop: '6px' }}>
              {/* a group with one page needs no heading: the page carries the same name */}
              {SETTINGS_PAGE_META.filter(p => p.group === g.id).length > 1 && (
                <div style={{
                  padding: '6px 10px 3px', fontSize: px(9), fontWeight: 700, color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.6px'
                }}>
                  {g.label}
                </div>
              )}
              {inGroup.map(item)}
            </div>
          )
        })}
      </div>
      <div style={{ padding: '8px 10px 10px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>{resetBtn}</div>
    </aside>
  )
}
