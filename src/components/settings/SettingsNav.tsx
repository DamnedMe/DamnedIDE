import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Bot, Cloud, FolderGit2, GitBranch, Languages, Palette, PenLine, PlugZap, RefreshCw, Rocket,
  RotateCcw, Search, Smartphone, Sun, TerminalSquare, Type, X
} from '@/components/icons'
import type { AppIcon } from '@/components/icons'
import type { SettingsPageId } from '../../store'
import { useI18n } from '../../i18n'
import { px } from './ui'

export interface SettingsGroup {
  id: string
  label: string
}

// labels and descriptions are English: translated at render with t()
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
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'git', label: 'Git' },
  { id: 'ado', label: 'Azure DevOps' },
  { id: 'ai', label: 'AI' },
  { id: 'devices', label: 'Devices' }
]

export const SETTINGS_PAGE_META: SettingsPageMeta[] = [
  {
    id: 'updates', group: 'general', label: 'Updates', icon: RefreshCw,
    description: 'installed version and automatic updates from GitHub',
    keywords: 'aggiornamenti versione ota update updates installa scarica release github riavvia'
  },
  {
    id: 'language', group: 'general', label: 'Language', icon: Languages,
    description: 'language of the IDE interface',
    keywords: 'lingua language italiano english inglese traduzione'
  },
  {
    id: 'theme', group: 'appearance', label: 'Theme', icon: Sun,
    description: 'dark or light theme, primary color, side of the side menu and standard theme',
    keywords: 'tema theme scuro chiaro dark light colore primario accento accent standard menu laterale sidebar sinistra destra left right layout'
  },
  {
    id: 'text', group: 'appearance', label: 'Text and icons', icon: Type,
    description: 'size of the text and icons, interface font',
    keywords: 'testo text font dimensione size carattere icone icon interfaccia famiglia family google fonts'
  },
  {
    id: 'colors', group: 'appearance', label: 'Colors', icon: Palette,
    description: 'syntax colors in the editor, for the active theme',
    keywords: 'colori colors sintassi syntax editor keyword parole chiave stringhe commenti tipi metodi palette'
  },
  {
    id: 'editor', group: 'editor', label: 'Editor', icon: PenLine,
    description: 'behavior of the code editor',
    keywords: 'editor minimap tab spazi indentazione numeri di riga line numbers a capo word wrap legature ligatures salvataggio automatico auto save scorciatoie navigazione keybindings'
  },
  {
    id: 'terminal', group: 'terminal', label: 'Terminal', icon: TerminalSquare,
    description: 'text size of the integrated terminals',
    keywords: 'terminale terminal console font dimensione size zoom ctrl rotellina xterm'
  },
  {
    id: 'git', group: 'git', label: 'Git', icon: GitBranch,
    description: 'GitTree client opened by the Git entry and the changes list',
    // no « path »: words match by prefix, « pat » must find only the PAT page
    keywords: 'git gittree client eseguibile executable percorso scarica download changes modifiche file nome cartella folder gruppi raggruppa tipologia worktree'
  },
  {
    id: 'ado-connections', group: 'ado', label: 'Connections', icon: Cloud,
    description: 'Azure DevOps organization, project and PAT',
    keywords: 'azure devops ado connessioni connection organization organizzazione project progetto pat token personal access'
  },
  {
    id: 'ado-folders', group: 'ado', label: 'Repositories by folder', icon: FolderGit2,
    description: 'which Azure DevOps repository each open folder uses',
    keywords: 'azure devops ado cartella cartelle folder repository repo mappatura worktree associazione'
  },
  {
    id: 'ado-release', group: 'ado', label: 'Release', icon: Rocket,
    description: 'BE and FE repositories promoted from the Release panel',
    keywords: 'azure devops ado rilascio release promozione promote be fe backend frontend dev qa prod'
  },
  {
    id: 'ai-agents', group: 'ai', label: 'Agents', icon: Bot,
    description: 'chat AI agents: access, check and model',
    keywords: 'ai agenti agents claude codex cursor opencode api key login modello model chat'
  },
  {
    id: 'ai-mcp', group: 'ai', label: 'MCP servers', icon: PlugZap,
    description: 'MCP tool servers (stdio) used by the agents',
    keywords: 'mcp server strumenti tools stdio plugin'
  },
  {
    id: 'remote', group: 'devices', label: 'Remote access', icon: Smartphone,
    description: 'DamnedCloud: pair a phone and control the IDE remotely',
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
 * `t` adds the translated label, group and description: either language matches.
 */
export function filterPages(query: string, t: (key: string) => string = k => k): SettingsPageMeta[] {
  const words = fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (words.length === 0) return SETTINGS_PAGE_META
  return SETTINGS_PAGE_META.filter(p => {
    const texts = [p.label, groupLabel(p.group), p.description]
    const hay = fold(`${texts.join(' ')} ${texts.map(x => t(x)).join(' ')} ${p.keywords}`).split(/[^\p{L}\p{N}]+/u)
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
  const t = useI18n()
  const pages = filterPages(query, t)

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
        placeholder={t('search settings')}
        aria-label={t('search settings')}
        spellCheck={false}
        title={t('search a settings page')}
        data-tip-desc={t('filter the pages by name and keywords (e.g. pat, font, worktree); Enter opens the first')}
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
        <button onClick={() => onQuery('')} title={t('clear the search')} data-tip-desc={t('show all the pages again')}
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
        title={t(p.label)}
        data-tip-desc={t(p.description)}
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
        <span style={{ flex: compact ? undefined : 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(p.label)}</span>
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
      title={t('reset defaults')}
      data-tip-desc={t('resets theme, colors, text, editor, terminal, language, GitTree and changes list to their initial values (asks for confirmation; Azure DevOps, agents and devices do not change)')}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexShrink: 0,
        width: compact ? undefined : '100%', padding: compact ? '0 8px' : '0 10px', minHeight: px(28),
        background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
        color: 'var(--text-muted)', cursor: 'pointer', fontSize: px(10), fontFamily: 'var(--font-mono)', fontWeight: 600
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--error-color)'; e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.background = 'var(--error-bg)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}>
      <RotateCcw size={11} />
      {!compact && t('reset defaults')}
    </button>
  )

  const empty = (
    <div style={{ padding: compact ? '4px 2px' : '14px 10px', color: 'var(--text-muted)', fontSize: px(10), fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
      {t('no page for «{query}»', { query: query.trim() })}
    </div>
  )

  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px 8px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-sidebar)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {search}
          {resetBtn}
        </div>
        <div ref={listRef} role="navigation" aria-label={t('settings pages')} onKeyDown={onListKey}
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
      <div ref={listRef} role="navigation" aria-label={t('settings pages')} onKeyDown={onListKey}
        style={{ position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 10px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {pages.length === 0 && empty}
        {SETTINGS_GROUPS.map(g => {
          const inGroup = pages.filter(p => p.group === g.id)
          if (inGroup.length === 0) return null
          return (
            <div key={g.id} role="group" aria-label={t(g.label)} style={{ display: 'flex', flexDirection: 'column', gap: '1px', paddingTop: '6px' }}>
              {/* a group with one page needs no heading: the page carries the same name */}
              {SETTINGS_PAGE_META.filter(p => p.group === g.id).length > 1 && (
                <div style={{
                  padding: '6px 10px 3px', fontSize: px(9), fontWeight: 700, color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.6px'
                }}>
                  {t(g.label)}
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
