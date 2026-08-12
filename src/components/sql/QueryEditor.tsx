import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import { defineThemes, THEME_DARK, THEME_LIGHT } from '../editor/monaco-theme'
import { useSettingsStore, useSqlStore } from '../../store'
import { Play, Square, Loader2, Database, Plus, X } from 'lucide-react'

export interface QueryExecutionContext {
  connectionId?: string
  database?: string
}

interface QueryEditorProps {
  connectionId: string | null
  activeDatabase?: string
  handleRef?: React.MutableRefObject<QueryEditorHandle | null>
  onExecute: (query: string, context?: QueryExecutionContext, tabId?: string) => Promise<boolean>
  onActiveTabChange?: (tabId: string, context?: QueryExecutionContext) => void
  onTabClosed?: (tabId: string) => void
}

interface QueryTab {
  id: string
  title: string
  query: string
  context?: QueryExecutionContext
  dirty: boolean
}

export interface QueryEditorHandle {
  getQuery: () => string
  setQuery: (text: string, execute?: boolean, context?: QueryExecutionContext) => void
  newQuery: (text?: string, execute?: boolean, context?: QueryExecutionContext) => void
  focus: () => void
}

const newTab = (index: number, query = '', context?: QueryExecutionContext): QueryTab => ({
  id: crypto.randomUUID(),
  title: `Query ${index}`,
  query,
  context,
  dirty: query.trim().length > 0
})

export function QueryEditor({ connectionId, activeDatabase, handleRef, onExecute, onActiveTabChange, onTabClosed }: QueryEditorProps) {
  const firstTab = useRef(newTab(1))
  const [tabs, setTabs] = useState<QueryTab[]>([firstTab.current])
  const [activeTabId, setActiveTabId] = useState(firstTab.current.id)
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const runRef = useRef<() => void>(() => {})
  const onExecuteRef = useRef(onExecute)
  const suppressChange = useRef(false)
  const pendingEditorValueRef = useRef<string | null>(null)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const { isRunning } = useSqlStore()
  const settings = useSettingsStore(s => s.settings)

  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  useEffect(() => { onExecuteRef.current = onExecute }, [onExecute])
  useEffect(() => { onActiveTabChange?.(firstTab.current.id) }, [])

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
    const activeTab = tabsRef.current.find(tab => tab.id === activeTabIdRef.current)
    replaceEditorValue(pendingEditorValueRef.current ?? activeTab?.query ?? '')
    editor.onDidChangeModelContent(() => {
      if (suppressChange.current) return
      const value = editor.getValue()
      const id = activeTabIdRef.current
      setTabs(current => current.map(tab => tab.id === id ? { ...tab, query: value, dirty: value.trim().length > 0 } : tab))
    })
    editor.addCommand(monaco.KeyCode.F5, () => runRef.current())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current())
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
      const cleared = { ...current[0], query: '', dirty: false, context: undefined }
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
      const executionContext = context ?? activeContext
      setTabs(current => current.map(tab => tab.id === id ? { ...tab, query: text, context: executionContext, dirty: text.trim().length > 0 } : tab))
      replaceEditorValue(text)
      if (execute) void executeText(text, executionContext, id)
    },
    newQuery: addTab,
    focus: () => editorRef.current?.focus()
  }

  const activeTab = tabs.find(tab => tab.id === activeTabId)
  const shownDatabase = activeTab?.context?.database ?? activeDatabase
  const cancel = () => {
    const { runningQueryId } = useSqlStore.getState()
    if (runningQueryId) void window.electronAPI.sql.cancelQuery(runningQueryId)
  }

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden',
      display: 'flex', flex: 1, flexDirection: 'column',
      width: '100%', height: '100%', minWidth: 0, minHeight: 0
    }}>
      <div style={{
        display: 'flex', alignItems: 'stretch', minHeight: '30px',
        borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)'
      }}>
        <div style={{ display: 'flex', flex: 1, overflowX: 'auto', minWidth: 0 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => activateTab(tab.id)} title={tab.title}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', minWidth: '96px', maxWidth: '180px',
                padding: '0 8px 0 10px', border: 'none', borderRight: '1px solid var(--border-subtle)',
                borderTop: tab.id === activeTabId ? '2px solid var(--accent-color)' : '2px solid transparent',
                background: tab.id === activeTabId ? 'var(--bg-card)' : 'transparent',
                color: tab.id === activeTabId ? 'var(--text-primary)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)', fontSize: '10px', cursor: 'pointer'
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
        </div>
        <button onClick={() => addTab()} title="new query tab" aria-label="new query tab"
          style={{ width: '30px', border: 'none', borderRight: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <Plus size={11} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 8px' }}>
          {shownDatabase && connectionId && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--accent-color)', fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
              <Database size={9} /> {shownDatabase}
            </span>
          )}
          {isRunning && (
            <button onClick={cancel} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 8px', fontSize: '10px', fontFamily: 'var(--font-mono)', background: 'var(--error-bg)', color: 'var(--error-color)', border: '1px solid var(--error-color)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
              <Square size={9} /> cancel
            </button>
          )}
          <button onClick={run} disabled={!connectionId || isRunning}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '10px', fontFamily: 'var(--font-mono)', background: connectionId && !isRunning ? 'var(--accent-color)' : 'var(--bg-disabled)', color: connectionId && !isRunning ? 'var(--text-inverse)' : 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: connectionId && !isRunning ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
            {isRunning ? <Loader2 size={10} style={{ animation: 'spin 0.9s linear infinite' }} /> : <Play size={10} />}
            {isRunning ? 'running…' : 'run'}
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
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
            padding: { top: 6, bottom: 6 },
            scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 }
          }}
        />
      </div>
    </div>
  )
}
