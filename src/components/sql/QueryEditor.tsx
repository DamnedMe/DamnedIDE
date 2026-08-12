import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import { defineThemes, THEME_DARK, THEME_LIGHT } from '../editor/monaco-theme'
import { useSettingsStore, useSqlStore, useToastStore } from '../../store'
import { Play, Square, Loader2, Database, Plus, X, History, Pencil, Save, Trash2, Server, ChevronRight } from 'lucide-react'
import { registerSqlAssistant } from './sqlAssistant'
import { SqlQuerySource, SqlWorkspaceTab } from '../../types/sql'

export interface QueryExecutionContext {
  connectionId?: string
  database?: string
  source?: SqlQuerySource
}

interface QueryEditorProps {
  connectionId: string | null
  connectionLabel?: string
  activeDatabase?: string
  handleRef?: React.MutableRefObject<QueryEditorHandle | null>
  onExecute: (query: string, context?: QueryExecutionContext, tabId?: string) => Promise<boolean>
  onActiveTabChange?: (tabId: string, context?: QueryExecutionContext) => void
  onTabClosed?: (tabId: string) => void
  restoredWorkspace?: { tabs: SqlWorkspaceTab[]; activeTabId: string | null } | null
  onWorkspaceChange?: (tabs: SqlWorkspaceTab[], activeTabId: string) => void
  onOpenWorkspace?: () => void
  onQueryChanged?: (tabId: string, query: string) => void
}

type QueryTab = SqlWorkspaceTab

export interface QueryEditorHandle {
  getQuery: () => string
  setQuery: (text: string, execute?: boolean, context?: QueryExecutionContext) => void
  newQuery: (text?: string, execute?: boolean, context?: QueryExecutionContext) => void
  focus: () => void
  renameTab: (id: string, title: string) => void
  activateTab: (id: string) => void
}

const newTab = (index: number, query = '', context?: QueryExecutionContext): QueryTab => ({
  id: crypto.randomUUID(),
  title: `Query ${index}`,
  query,
  context,
  dirty: query.trim().length > 0
})

export function QueryEditor({ connectionId, connectionLabel, activeDatabase, handleRef, onExecute, onActiveTabChange, onTabClosed, restoredWorkspace, onWorkspaceChange, onOpenWorkspace, onQueryChanged }: QueryEditorProps) {
  const firstTab = useRef(newTab(1))
  const [tabs, setTabs] = useState<QueryTab[]>([firstTab.current])
  const [activeTabId, setActiveTabId] = useState(firstTab.current.id)
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renameTab, setRenameTab] = useState<{ id: string; title: string; x: number; y: number } | null>(null)
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const runRef = useRef<() => void>(() => {})
  const onExecuteRef = useRef(onExecute)
  const suppressChange = useRef(false)
  const pendingEditorValueRef = useRef<string | null>(null)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const connectionIdRef = useRef(connectionId)
  const activeDatabaseRef = useRef(activeDatabase)
  const assistantDisposableRef = useRef<{ dispose(): void } | null>(null)
  const restoredRef = useRef(false)
  const { isRunning } = useSqlStore()
  const settings = useSettingsStore(s => s.settings)
  const showToast = useToastStore(s => s.showToast)

  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  useEffect(() => { onExecuteRef.current = onExecute }, [onExecute])
  useEffect(() => { onActiveTabChange?.(firstTab.current.id) }, [])
  useEffect(() => { connectionIdRef.current = connectionId }, [connectionId])
  useEffect(() => { activeDatabaseRef.current = activeDatabase }, [activeDatabase])
  useEffect(() => () => assistantDisposableRef.current?.dispose(), [])
  useEffect(() => { onWorkspaceChange?.(tabs, activeTabId) }, [activeTabId, onWorkspaceChange, tabs])

  const applyTheme = (monaco: typeof import('monaco-editor')) => {
    defineThemes(monaco, settings.themeColors)
    monaco.editor.setTheme(settings.theme === 'dark' ? THEME_DARK : THEME_LIGHT)
  }

  const replaceEditorValue = useCallback((text: string) => {
    pendingEditorValueRef.current = text
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    suppressChange.current = true
    model.setValue(text)
    editor.setPosition({ lineNumber: 1, column: 1 })
    suppressChange.current = false
    pendingEditorValueRef.current = null
    editor.focus()
  }, [])

  useEffect(() => {
    if (restoredRef.current || !restoredWorkspace) return
    restoredRef.current = true
    if (restoredWorkspace.tabs.length === 0) return
    const restoredTabs = restoredWorkspace.tabs.map(tab => ({ ...tab, dirty: Boolean(tab.dirty) }))
    const restoredActive = restoredTabs.some(tab => tab.id === restoredWorkspace.activeTabId)
      ? restoredWorkspace.activeTabId!
      : restoredTabs[0].id
    tabsRef.current = restoredTabs
    activeTabIdRef.current = restoredActive
    setTabs(restoredTabs)
    setActiveTabId(restoredActive)
    const active = restoredTabs.find(tab => tab.id === restoredActive)!
    replaceEditorValue(active.query)
    onActiveTabChange?.(active.id, active.context)
  }, [onActiveTabChange, replaceEditorValue, restoredWorkspace])

  const executeText = useCallback(async (text: string, context?: QueryExecutionContext, tabId = activeTabIdRef.current) => {
    const query = text.trim()
    if (!query) return false
    if (useSqlStore.getState().isRunning) {
      await new Promise<void>(resolve => {
        const unsubscribe = useSqlStore.subscribe(state => {
          if (!state.isRunning) {
            unsubscribe()
            resolve()
          }
        })
      })
    }
    return onExecuteRef.current(query, context, tabId)
  }, [])

  const saveTab = useCallback(async (id = activeTabIdRef.current) => {
    const tab = tabsRef.current.find(item => item.id === id)
    if (!tab) return
    const baseTitle = tab.title.replace(/\.sql$/i, '').trim() || 'query'
    try {
      const filePath = await window.electronAPI.dialog.saveSqlQuery(`${baseTitle}.sql`, tab.query)
      if (!filePath) return
      const fileName = filePath.split(/[\\/]/).pop() || `${baseTitle}.sql`
      const title = fileName.replace(/\.sql$/i, '') || baseTitle
      tabsRef.current = tabsRef.current.map(item => item.id === id ? { ...item, title, filePath, dirty: false } : item)
      setTabs(tabsRef.current)
      showToast(`query salvata: ${fileName}`)
    } catch (error) {
      showToast(`salvataggio query fallito: ${(error as Error).message}`, 'error')
    }
  }, [showToast])

  const run = useCallback(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    const selection = editor.getSelection()
    const query = selection && !selection.isEmpty() ? model.getValueInRange(selection) : model.getValue()
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current)
    void executeText(query, tab?.context, tab?.id)
  }, [executeText])
  runRef.current = run

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    applyTheme(monaco)
    assistantDisposableRef.current?.dispose()
    assistantDisposableRef.current = registerSqlAssistant(monaco, () => {
      const tab = tabsRef.current.find(item => item.id === activeTabIdRef.current)
      return {
        connectionId: tab?.context?.connectionId ?? connectionIdRef.current,
        database: tab?.context?.database ?? activeDatabaseRef.current
      }
    })
    const activeTab = tabsRef.current.find(tab => tab.id === activeTabIdRef.current)
    replaceEditorValue(pendingEditorValueRef.current ?? activeTab?.query ?? '')
    editor.onDidChangeModelContent(() => {
      if (suppressChange.current) return
      const value = editor.getValue()
      const id = activeTabIdRef.current
      setTabs(current => current.map(tab => tab.id === id ? { ...tab, query: value, dirty: value.trim().length > 0 } : tab))
      onQueryChanged?.(id, value)
    })
    editor.addCommand(monaco.KeyCode.F5, () => runRef.current())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveTab(activeTabIdRef.current) })
    editor.focus()
  }

  useEffect(() => {
    if (monacoRef.current) applyTheme(monacoRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.theme, settings.themeColors, settings.fontSize])

  // One global shortcut is enough; Monaco's command handles the focused editor.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'F5' || editorRef.current?.hasTextFocus()) return
      const target = event.target as HTMLElement
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      event.preventDefault()
      run()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [run])

  const activateTab = (id: string) => {
    const target = tabsRef.current.find(tab => tab.id === id)
    if (!target) return
    setActiveTabId(id)
    activeTabIdRef.current = id
    replaceEditorValue(target.query)
    onActiveTabChange?.(id, target.context)
  }

  const addTab = useCallback((text = '', execute = false, context?: QueryExecutionContext) => {
    const tab = newTab(tabsRef.current.length + 1, text, context)
    tabsRef.current = [...tabsRef.current, tab]
    setTabs(tabsRef.current)
    setActiveTabId(tab.id)
    activeTabIdRef.current = tab.id
    replaceEditorValue(text)
    onActiveTabChange?.(tab.id, tab.context)
    if (execute) void executeText(text, context, tab.id)
  }, [executeText, onActiveTabChange, replaceEditorValue])

  const closeTab = (id: string) => {
    const current = tabsRef.current
    if (current.length === 1) {
      const cleared = { ...current[0], title: 'Query 1', query: '', dirty: false, context: undefined, filePath: undefined }
      tabsRef.current = [cleared]
      setTabs([cleared])
      replaceEditorValue('')
      onTabClosed?.(id)
      return
    }
    const index = current.findIndex(tab => tab.id === id)
    const next = current.filter(tab => tab.id !== id)
    tabsRef.current = next
    setTabs(next)
    onTabClosed?.(id)
    if (id === activeTabIdRef.current) {
      const target = next[Math.max(0, index - 1)] || next[0]
      setActiveTabId(target.id)
      activeTabIdRef.current = target.id
      replaceEditorValue(target.query)
      onActiveTabChange?.(target.id, target.context)
    }
  }

  if (handleRef) handleRef.current = {
    getQuery: () => editorRef.current?.getValue() || '',
    setQuery: (text, execute, context) => {
      const id = activeTabIdRef.current
      const activeContext = tabsRef.current.find(tab => tab.id === id)?.context
      const executionContext = context ? { ...activeContext, ...context } : activeContext
      setTabs(current => current.map(tab => tab.id === id ? { ...tab, query: text, context: executionContext, dirty: text.trim().length > 0 } : tab))
      replaceEditorValue(text)
      if (execute) void executeText(text, executionContext, id)
    },
    newQuery: addTab,
    focus: () => editorRef.current?.focus(),
    renameTab: (id, title) => {
      const normalized = title.trim().slice(0, 120)
      if (!normalized) return
      tabsRef.current = tabsRef.current.map(tab => tab.id === id ? { ...tab, title: normalized } : tab)
      setTabs(tabsRef.current)
    },
    activateTab
  }

  const activeTab = tabs.find(tab => tab.id === activeTabId)
  const shownDatabase = activeTab?.context?.database ?? activeDatabase
  const cancel = () => {
    const { runningQueryId } = useSqlStore.getState()
    if (runningQueryId) void window.electronAPI.sql.cancelQuery(runningQueryId)
  }

  return (
    <section className="sql-query-editor sql-surface" aria-label="Query editor" style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden',
      display: 'flex', flex: 1, flexDirection: 'column',
      width: '100%', height: '100%', minWidth: 0, minHeight: 0
    }}>
      <header className="sql-query-editor__chrome" style={{
        display: 'flex', alignItems: 'stretch', minHeight: '30px',
        borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)'
      }}>
        <nav className="sql-query-tabs" aria-label="Query tabs" style={{ display: 'flex', flex: 1, overflowX: 'auto', minWidth: 0 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => activateTab(tab.id)} title={tab.title}
              className="sql-query-tab"
              data-active={tab.id === activeTabId}
              onContextMenu={(event) => {
                event.preventDefault()
                activateTab(tab.id)
                setTabMenu({ id: tab.id, x: event.clientX, y: event.clientY })
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                closeTab(tab.id)
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', minWidth: '96px', maxWidth: '180px',
                padding: '0 8px 0 10px', border: 'none', borderRight: '1px solid var(--border-subtle)',
                borderTop: tab.id === activeTabId ? '2px solid var(--accent-color)' : '2px solid transparent',
                background: tab.id === activeTabId ? 'var(--bg-card)' : 'transparent',
                color: tab.id === activeTabId ? 'var(--text-primary)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', cursor: 'pointer'
              }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
                {tab.title}{tab.dirty ? ' •' : ''}
              </span>
              <span role="button" aria-label={`close ${tab.title}`} onClick={(event) => { event.stopPropagation(); closeTab(tab.id) }}
                style={{ display: 'inline-flex', padding: '2px', borderRadius: '3px' }}>
                <X size={9} />
              </span>
            </button>
          ))}
        </nav>
        <button onClick={() => addTab()} title="new query tab" aria-label="new query tab"
          className="sql-query-action"
          style={{ width: '30px', border: 'none', borderRight: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <Plus size={11} />
        </button>
        {onOpenWorkspace && (
          <button onClick={onOpenWorkspace} title="workspace, history and favorites" aria-label="open SQL workspace"
            className="sql-query-action"
            style={{ width: '30px', border: 'none', borderRight: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <History size={11} />
          </button>
        )}
        <div className="sql-query-editor__actions" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 8px' }}>
          {shownDatabase && connectionId && (
            <span className="sql-context-chip" title={`${connectionLabel || connectionId} / ${shownDatabase}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--accent-color)', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
              <Server size={10} />
              <span className="sql-context-chip__server">{connectionLabel || connectionId}</span>
              <ChevronRight size={9} aria-hidden="true" />
              <Database size={10} />
              <strong>{shownDatabase}</strong>
            </span>
          )}
          {isRunning && (
            <button onClick={cancel} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 8px', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', background: 'var(--error-bg)', color: 'var(--error-color)', border: '1px solid var(--error-color)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
              <Square size={9} /> cancel
            </button>
          )}
          <button className="sql-run-button" onClick={run} disabled={!connectionId || isRunning}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', background: connectionId && !isRunning ? 'var(--accent-color)' : 'var(--bg-disabled)', color: connectionId && !isRunning ? 'var(--text-inverse)' : 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: connectionId && !isRunning ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
            {isRunning ? <Loader2 size={10} style={{ animation: 'spin 0.9s linear infinite' }} /> : <Play size={10} />}
            {isRunning ? 'Running…' : 'Run'}
          </button>
        </div>
      </header>
      <div className="sql-query-editor__canvas" style={{ flex: 1, minHeight: 0 }}>
        <Editor
          language="sql"
          theme={settings.theme === 'dark' ? THEME_DARK : THEME_LIGHT}
          onMount={handleMount}
          options={{
            fontSize: settings.fontSize,
            fontFamily: 'var(--font-mono)',
            minimap: { enabled: false },
            lineNumbersMinChars: 3,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'off',
            tabSize: settings.tabSize,
            fontLigatures: settings.fontLigatures,
            renderLineHighlight: 'line',
            fixedOverflowWidgets: true,
            padding: { top: 6, bottom: 6 },
            scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 }
          }}
        />
      </div>
      {tabMenu && (
        <>
          <div onMouseDown={() => setTabMenu(null)} onContextMenu={(event) => { event.preventDefault(); setTabMenu(null) }} style={{ position: 'fixed', inset: 0, zIndex: 299 }} />
          <div role="menu" aria-label="query tab actions" style={{
            position: 'fixed', left: Math.min(tabMenu.x, window.innerWidth - 190), top: Math.min(tabMenu.y, window.innerHeight - 132), zIndex: 300,
            width: 180, padding: '4px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--font-mono)'
          }}>
            <button className="sql-tab-menu-item" role="menuitem" onClick={() => {
              const tab = tabsRef.current.find(item => item.id === tabMenu.id)
              if (tab) setRenameTab({ id: tab.id, title: tab.title, x: tabMenu.x, y: tabMenu.y })
              setTabMenu(null)
            }} style={menuItemStyle}><Pencil size={11} /> Rename</button>
            <button className="sql-tab-menu-item" role="menuitem" onClick={() => { const id = tabMenu.id; setTabMenu(null); void saveTab(id) }} style={menuItemStyle}><Save size={11} /> Save query</button>
            <div style={{ height: 1, background: 'var(--border-subtle)', margin: '3px 2px' }} />
            <button className="sql-tab-menu-item" role="menuitem" onClick={() => { const id = tabMenu.id; setTabMenu(null); closeTab(id) }} style={{ ...menuItemStyle, color: 'var(--error-color)' }}><Trash2 size={11} /> Close</button>
          </div>
        </>
      )}
      {renameTab && (
        <>
          <div onMouseDown={() => setRenameTab(null)} style={{ position: 'fixed', inset: 0, zIndex: 299 }} />
          <form onSubmit={(event) => {
            event.preventDefault()
            const normalized = renameTab.title.trim().slice(0, 120)
            if (normalized) {
              tabsRef.current = tabsRef.current.map(tab => tab.id === renameTab.id ? { ...tab, title: normalized } : tab)
              setTabs(tabsRef.current)
            }
            setRenameTab(null)
          }} style={{
            position: 'fixed', left: Math.min(renameTab.x, window.innerWidth - 270), top: Math.min(renameTab.y, window.innerHeight - 82), zIndex: 300,
            width: 260, padding: 8, display: 'flex', gap: 5, background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)'
          }}>
            <input autoFocus aria-label={`rename ${tabsRef.current.find(tab => tab.id === renameTab.id)?.title || 'query'}`} value={renameTab.title}
              onChange={(event) => setRenameTab(current => current ? { ...current, title: event.target.value } : current)}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setRenameTab(null) } }}
              style={{ minWidth: 0, flex: 1, height: 27, padding: '0 7px', background: 'var(--bg-input)', border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none' }} />
            <button type="submit" style={{ ...menuItemStyle, width: 'auto', border: '1px solid var(--accent-color)', color: 'var(--accent-color)' }}>rename</button>
          </form>
        </>
      )}
    </section>
  )
}

const menuItemStyle: React.CSSProperties = {
  width: '100%', height: 28, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 7,
  border: 0, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-primary)',
  cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, textAlign: 'left'
}
