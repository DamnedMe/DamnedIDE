import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { RotateCcw } from '@/components/icons'
import { useSettingsStore, useToastStore, useWorktreeStore, useEditorStore, useSettingsNavStore, useAdoSettingsStore } from '../../store'
import type { SettingsPageId } from '../../store'
import { PanelContainer } from '../layout/PanelContainer'
import { Modal } from '../layout/Modal'
import { McpPanel } from '../mcp/McpPanel'
import { TerminalDock } from '../terminal/TerminalDock'
import { AgentSettings } from './AgentSettings'
import { RemotePanel } from './RemotePanel'
import { SettingsNav, groupLabel, pageMeta } from './SettingsNav'
import { Btn, PageHeader, px } from './ui'
import { LanguagePage, UpdatesPage } from './pages/GeneralPages'
import { ColorsPage, TextPage, ThemePage } from './pages/AppearancePages'
import { EditorPage, GitPage, TerminalPage } from './pages/ToolsPages'
import { ConnectionsPage } from './ado/ConnectionsPage'
import { FoldersPage } from './ado/FoldersPage'
import { ReleasePage } from './ado/ReleasePage'

// under this panel width the navigation becomes a strip above the content
const COMPACT_WIDTH = 640

/**
 * IDE settings: a navigation (search, groups, pages) and the page content. The
 * page is remembered (useSettingsNavStore) and any panel can open a given page
 * with openSettings(page). repoPath: the open repository, for the Azure DevOps
 * folder pages.
 */
export function SettingsPanel({ repoPath = null }: { repoPath?: string | null } = {}) {
  const page = useSettingsNavStore(s => s.page)
  const setPage = useSettingsNavStore(s => s.setPage)
  const theme = useSettingsStore(s => s.settings.theme)
  const resetSettings = useSettingsStore(s => s.resetSettings)
  const showToast = useToastStore(s => s.showToast)
  const adoSettings = useAdoSettingsStore(s => s.settings)
  // the terminal dock lives here too, so "accedi" (agent login) is visible without
  // switching panel; the login runs in the selected worktree/repo when available
  const dockWorktree = useWorktreeStore(s => s.selectedWorktree)
  const dockRoot = useEditorStore(s => s.editorRootPath)
  const dockRepoPath = dockWorktree || dockRoot

  const [query, setQuery] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [compact, setCompact] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  // OTA state, kept in sync with the main process (the nav marks a ready version)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  useEffect(() => {
    window.electronAPI.updater.state().then(setUpdate).catch(() => { /* main not ready */ })
    return window.electronAPI.updater.onState(setUpdate)
  }, [])

  // the panel width (not the window: the panel can be detached or docked) picks the layout
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth
      setCompact(w > 0 && w < COMPACT_WIDTH)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // a new page starts from its top
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }) }, [page])

  const badges = useMemo(() => {
    const out: Partial<Record<SettingsPageId, { tone: 'accent' | 'warning'; tip: string }>> = {}
    if (update?.status === 'downloaded') out.updates = { tone: 'accent', tip: `versione ${update.version ?? ''} pronta da installare` }
    else if (update?.status === 'available') out.updates = { tone: 'accent', tip: `nuova versione ${update.version ?? ''} disponibile` }
    const missing = (adoSettings?.connections ?? []).filter(c => !adoSettings?.tokens[c.id]).length
    if (missing > 0) out['ado-connections'] = { tone: 'warning', tip: missing === 1 ? 'una connessione senza PAT' : `${missing} connessioni senza PAT` }
    return out
  }, [update, adoSettings])

  const meta = pageMeta(page)
  const Icon = meta.icon

  const doReset = () => {
    resetSettings()
    setConfirmReset(false)
    showToast('impostazioni ripristinate ai valori predefiniti')
  }

  let content: ReactNode
  switch (page) {
    case 'updates': content = <UpdatesPage update={update} setUpdate={setUpdate} />; break
    case 'language': content = <LanguagePage />; break
    case 'theme': content = <ThemePage onOpenPage={setPage} />; break
    case 'text': content = <TextPage />; break
    case 'colors': content = <ColorsPage />; break
    case 'editor': content = <EditorPage onOpenPage={setPage} />; break
    case 'terminal': content = <TerminalPage />; break
    case 'git': content = <GitPage />; break
    case 'ado-connections': content = <ConnectionsPage onOpenPage={setPage} />; break
    case 'ado-folders': content = <FoldersPage repoPath={repoPath} onOpenPage={setPage} />; break
    case 'ado-release': content = <ReleasePage repoPath={repoPath} onOpenPage={setPage} />; break
    case 'ai-agents': content = <AgentSettings />; break
    case 'ai-mcp': content = <McpPanel />; break
    case 'remote': content = <RemotePanel />; break
  }

  const description = page === 'colors'
    ? `${meta.description} (${theme === 'dark' ? 'scuro' : 'chiaro'})`
    : meta.description

  return (
    <PanelContainer>
      <div ref={rootRef} style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: compact ? 'column' : 'row', overflow: 'hidden' }}>
          <SettingsNav
            page={page}
            onSelect={setPage}
            query={query}
            onQuery={setQuery}
            onReset={() => setConfirmReset(true)}
            badges={badges}
            compact={compact}
          />
          <div ref={contentRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
            <div key={page} style={{
              maxWidth: '860px', padding: compact ? '14px 12px 20px' : '18px 22px 24px',
              display: 'flex', flexDirection: 'column', gap: '10px', animation: 'fadeIn 160ms ease'
            }}>
              <PageHeader icon={<Icon size={16} />} group={groupLabel(meta.group) !== meta.label ? groupLabel(meta.group) : undefined}
                title={meta.label} description={description} />
              {content}
            </div>
          </div>
        </div>
        <TerminalDock repoPath={dockRepoPath} />
      </div>

      {confirmReset && (
        <Modal onClose={() => setConfirmReset(false)} width={440} label="ripristina predefiniti">
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <RotateCcw size={15} style={{ color: 'var(--error-color)', flexShrink: 0 }} />
              <span style={{ fontSize: px(13), fontWeight: 700, color: 'var(--text-primary)' }}>
                ripristinare le impostazioni predefinite?
              </span>
            </div>
            <div style={{ fontSize: px(11), color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              tema, colori, testo e icone, font aggiunti, editor, terminale, lingua e percorso di GitTree tornano ai valori iniziali.
              {' '}Non cambiano le connessioni Azure DevOps, gli agenti AI, i server MCP e i dispositivi associati.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Btn onClick={() => setConfirmReset(false)}>annulla</Btn>
              <Btn variant="primary" onClick={doReset} style={{ background: 'var(--error-color)' }}
                title="ripristina predefiniti" data-tip-desc="applies the default settings at once">
                <RotateCcw size={11} /> ripristina
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </PanelContainer>
  )
}
