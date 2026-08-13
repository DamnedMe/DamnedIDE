import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { X, ChevronUp, ChevronDown, Save, Loader2, GitMerge, ArrowRight } from 'lucide-react'
import { useUIStore, useSettingsStore } from '../../store'
import { defineThemes, THEME_DARK, THEME_LIGHT, patchCSharpGrammar } from '../editor/monaco-theme'
import { detectLangForMerge } from './merge-utils'

interface MergeToolProps {
  repoPath: string
  filePath: string
  onClose: () => void
  onResolved: () => void
}

interface ConflictBlock {
  index: number
  startLine: number // 1-based line of '<<<<<<<'
  endLine: number // 1-based line of '>>>>>>>'
  ours: string[]
  theirs: string[]
}

const MARKER_START = '<<<<<<<'
const MARKER_SEP = '======='
const MARKER_END = '>>>>>>>'

function parseConflicts(text: string): ConflictBlock[] {
  const lines = text.split('\n')
  const blocks: ConflictBlock[] = []
  let pendingStart = -1
  let pendingSep = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith(MARKER_START)) {
      pendingStart = i
      pendingSep = -1
    } else if (line.startsWith(MARKER_SEP) && pendingStart >= 0) {
      pendingSep = i
    } else if (line.startsWith(MARKER_END) && pendingStart >= 0 && pendingSep >= 0) {
      blocks.push({
        index: blocks.length,
        startLine: pendingStart + 1,
        endLine: i + 1,
        ours: lines.slice(pendingStart + 1, pendingSep),
        theirs: lines.slice(pendingSep + 1, i)
      })
      pendingStart = -1
      pendingSep = -1
    }
  }
  return blocks
}

function resolveBlock(text: string, block: ConflictBlock, choice: 'ours' | 'theirs' | 'both'): string {
  const lines = text.split('\n')
  const chosen = choice === 'ours' ? block.ours : choice === 'theirs' ? block.theirs : [...block.ours, ...block.theirs]
  const head = lines.slice(0, block.startLine - 1)
  const tail = lines.slice(block.endLine)
  return [...head, ...chosen, ...tail].join('\n')
}

function applyEditorTheme(monaco: typeof import('monaco-editor')) {
  const theme = useUIStore.getState().theme
  const themeColors = useSettingsStore.getState().settings.themeColors
  defineThemes(monaco, themeColors)
  patchCSharpGrammar(monaco)
  monaco.editor.setTheme(theme === 'dark' ? THEME_DARK : THEME_LIGHT)
}

// 3-way merge tool for a conflicted file, VS-style: ours | theirs read-only on top,
// editable result below with per-conflict "take ours/theirs/both" actions.
export function MergeTool({ repoPath, filePath, onClose, onResolved }: MergeToolProps) {
  const theme = useUIStore(s => s.theme)
  const [ours, setOurs] = useState('')
  const [theirs, setTheirs] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const resultEditorRef = useRef<any>(null)

  const conflicts = useMemo(() => parseConflicts(result), [result])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [o, t, w] = await Promise.all([
          window.electronAPI.git.showRef(repoPath, filePath, ':2').catch(() => ''),
          window.electronAPI.git.showRef(repoPath, filePath, ':3').catch(() => ''),
          window.electronAPI.fs.readFile(`${repoPath}/${filePath}`).catch(() => '')
        ])
        if (cancelled) return
        setOurs(o)
        setTheirs(t)
        setResult(w)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [repoPath, filePath])

  const revealConflict = (idx: number) => {
    setActive(idx)
    const block = conflicts[idx]
    if (block && resultEditorRef.current) {
      try { resultEditorRef.current.revealLineInCenter(block.startLine) } catch { /* ignore */ }
    }
  }

  const applyToBlock = (idx: number, choice: 'ours' | 'theirs' | 'both') => {
    const block = conflicts[idx]
    if (!block) return
    setResult(resolveBlock(result, block, choice))
  }

  const applyToAll = (choice: 'ours' | 'theirs' | 'both') => {
    let text = result
    for (const block of [...conflicts].reverse()) {
      text = resolveBlock(text, block, choice)
    }
    setResult(text)
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await window.electronAPI.fs.writeFile(`${repoPath}/${filePath}`, result)
      // staging the file marks the conflict as resolved in git
      await window.electronAPI.git.stage(repoPath, [filePath])
      onResolved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  const lang = detectLangForMerge(filePath)
  const editorTheme = theme === 'dark' ? THEME_DARK : THEME_LIGHT
  const readOnlyOptions = {
    fontSize: 12.5,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
    readOnly: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    lineNumbers: 'on' as const,
    renderWhitespace: 'selection' as const,
    wordWrap: 'off' as const,
    stickyScroll: { enabled: true, maxLineCount: 3 },
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }
  }

  const paneLabel = (label: string, color: string) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px',
      fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700,
      color, textTransform: 'uppercase', letterSpacing: '0.5px',
      fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-primary)', flexShrink: 0
    }}>
      {label}
    </div>
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 300, backdropFilter: 'blur(2px)'
    }}>
      <div style={{
        width: '94%', height: '92%', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden',
        fontFamily: 'var(--font-mono)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-primary)', flexShrink: 0, gap: '10px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
            <GitMerge size={15} style={{ color: 'var(--error-color)', flexShrink: 0 }} />
            <span style={{
              fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontWeight: 600,
              color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>
              {filePath}
            </span>
            {!loading && (
              <span style={{
                padding: '1px 8px', borderRadius: 'var(--radius-sm)',
                background: conflicts.length > 0 ? 'var(--error-bg)' : 'var(--success-bg)',
                color: conflicts.length > 0 ? 'var(--error-color)' : 'var(--success-color)',
                fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, flexShrink: 0
              }}>
                {conflicts.length > 0 ? `${conflicts.length} conflicts` : 'resolved'}
              </span>
            )}
          </div>
          <button onClick={onClose} title="close"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '26px', height: '26px', background: 'transparent',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}>
            <X size={13} />
          </button>
        </div>

        {/* Toolbar: take-all + save */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px',
          borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
          flexShrink: 0, flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>all conflicts:</span>
          <ToolBtn label="take ours" title="resolve every conflict with the current side (HEAD)" onClick={() => applyToAll('ours')} color="var(--accent-color)" />
          <ToolBtn label="take theirs" title="resolve every conflict with the incoming side" onClick={() => applyToAll('theirs')} color="var(--warning-color)" />
          <ToolBtn label="take both" title="keep both sides in order (current then incoming)" onClick={() => applyToAll('both')} color="var(--success-color)" />
          <div style={{ flex: 1 }} />
          <button onClick={handleSave} disabled={saving || loading}
            title="write the result and mark the conflict resolved"
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 14px', height: '26px',
              background: conflicts.length > 0 ? 'var(--accent-color)' : 'var(--success-color)',
              border: 'none', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-inverse)', cursor: saving || loading ? 'not-allowed' : 'pointer',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 600,
              opacity: saving || loading ? 0.6 : 1
            }}>
            {saving ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={11} />}
            {saving ? 'saving' : 'save & resolve'}
          </button>
        </div>

        {/* Ours | Theirs */}
        <div style={{ flex: '0 0 38%', display: 'flex', minHeight: 0, borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--border-color)' }}>
            {paneLabel('ours — current (HEAD)', 'var(--accent-color)')}
            <div style={{ flex: 1, minHeight: 0 }}>
              <Editor height="100%" language={lang} theme={editorTheme}
                value={ours} options={readOnlyOptions} onMount={(_e, monaco) => applyEditorTheme(monaco)} />
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {paneLabel('theirs — incoming', 'var(--warning-color)')}
            <div style={{ flex: 1, minHeight: 0 }}>
              <Editor height="100%" language={lang} theme={editorTheme}
                value={theirs} options={readOnlyOptions} onMount={(_e, monaco) => applyEditorTheme(monaco)} />
            </div>
          </div>
        </div>

        {/* Conflicts navigator */}
        {conflicts.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px',
            background: 'var(--error-bg)', borderBottom: '1px solid var(--error-color)',
            flexShrink: 0, flexWrap: 'wrap'
          }}>
            <button onClick={() => revealConflict(Math.max(0, active - 1))} title="previous conflict"
              style={navBtnStyle}>
              <ChevronUp size={11} />
            </button>
            <button onClick={() => revealConflict(Math.min(conflicts.length - 1, active + 1))} title="next conflict"
              style={navBtnStyle}>
              <ChevronDown size={11} />
            </button>
            {conflicts.map((c) => (
              <div key={c.index} style={{
                display: 'flex', alignItems: 'center', gap: '3px', padding: '2px 4px',
                borderRadius: 'var(--radius-sm)',
                background: c.index === active ? 'var(--bg-active)' : 'transparent',
                border: `1px solid ${c.index === active ? 'var(--error-color)' : 'var(--border-color)'}`,
                cursor: 'pointer'
              }}
                onClick={() => revealConflict(c.index)}
                title={`conflict #${c.index + 1} — lines ${c.startLine}-${c.endLine}`}>
                <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--error-color)', fontWeight: 700 }}>
                  #{c.index + 1}
                </span>
                <button onClick={(e) => { e.stopPropagation(); applyToBlock(c.index, 'ours') }}
                  title="use the current side for this conflict"
                  style={{ ...chipBtn, color: 'var(--accent-color)', border: '1px solid var(--accent-color)' }}>
                  O
                </button>
                <button onClick={(e) => { e.stopPropagation(); applyToBlock(c.index, 'theirs') }}
                  title="use the incoming side for this conflict"
                  style={{ ...chipBtn, color: 'var(--warning-color)', border: '1px solid var(--warning-color)' }}>
                  T
                </button>
                <button onClick={(e) => { e.stopPropagation(); applyToBlock(c.index, 'both') }}
                  title="keep both sides for this conflict"
                  style={{ ...chipBtn, color: 'var(--success-color)', border: '1px solid var(--success-color)' }}>
                  B
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Result */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {paneLabel('result — edit freely, then save', 'var(--text-secondary)')}
          <div style={{ flex: 1, minHeight: 0 }}>
            <Editor height="100%" language={lang} theme={editorTheme}
              value={result}
              onChange={(v) => setResult(v || '')}
              onMount={(editor, monaco) => {
                applyEditorTheme(monaco)
                resultEditorRef.current = editor
              }}
              options={{
                fontSize: 12.5,
                fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                lineNumbers: 'on',
                renderWhitespace: 'selection',
                wordWrap: 'off',
                stickyScroll: { enabled: true, maxLineCount: 3 },
                scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }
              }}
            />
          </div>
        </div>

        {error && (
          <div style={{
            padding: '6px 10px', background: 'var(--error-bg)', color: 'var(--error-color)',
            fontSize: 'calc(10px * var(--ui-text-scale, 1))', borderTop: '1px solid var(--error-color)', flexShrink: 0
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '20px', height: '20px', background: 'transparent',
  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text-muted)', cursor: 'pointer'
}

const chipBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '18px', height: '18px', padding: 0, background: 'transparent',
  borderRadius: '3px', cursor: 'pointer', fontSize: '9px', fontWeight: 700
}

function ToolBtn({ label, title, onClick, color }: {
  label: string
  title: string
  onClick: () => void
  color: string
}) {
  return (
    <button onClick={onClick} title={title} style={{
      display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', height: '22px',
      background: 'var(--bg-card)', border: `1px solid ${color}`,
      borderRadius: 'var(--radius-sm)', color, cursor: 'pointer',
      fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 600
    }}
      onMouseEnter={(e) => { e.currentTarget.style.background = color; e.currentTarget.style.color = 'var(--text-inverse)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = color }}>
      <ArrowRight size={10} />
      {label}
    </button>
  )
}
