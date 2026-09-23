import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { X, ChevronUp, ChevronDown, Save, Loader2, GitMerge, Check, ArrowRight, Columns2, FileDiff } from 'lucide-react'
import { useUIStore, useSettingsStore } from '../../store'
import { defineThemes, THEME_DARK, THEME_LIGHT, patchCSharpGrammar } from '../editor/monaco-theme'
import {
  detectLangForMerge, parseConflicts, applyChoices, unresolvedCount,
  type ConflictBlock, type MergeSide
} from './merge-utils'

interface MergeToolProps {
  repoPath: string
  filePath: string
  onClose: () => void
  onResolved: () => void
}

function applyEditorTheme(monaco: typeof import('monaco-editor')) {
  const theme = useUIStore.getState().theme
  const themeColors = useSettingsStore.getState().settings.themeColors
  defineThemes(monaco, themeColors)
  patchCSharpGrammar(monaco)
  monaco.editor.setTheme(theme === 'dark' ? THEME_DARK : THEME_LIGHT)
}

// Visual-Studio style conflict editor: every conflict is shown as a hunk with the
// two sides side by side, and clicking a side takes it (click again to undo). The
// merged result is built live on the right and stays editable for manual fixes.
export function MergeTool({ repoPath, filePath, onClose, onResolved }: MergeToolProps) {
  const theme = useUIStore(s => s.theme)
  const [original, setOriginal] = useState('')
  const [choices, setChoices] = useState<Record<number, MergeSide | undefined>>({})
  // manual edits in the result pane take precedence until a choice changes
  const [manual, setManual] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const conflicted = await window.electronAPI.fs.readFile(`${repoPath}/${filePath}`).catch(() => '')
        if (cancelled) return
        setOriginal(conflicted)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [repoPath, filePath])

  const blocks = useMemo(() => parseConflicts(original), [original])
  const merged = useMemo(
    () => (manual !== null ? manual : applyChoices(original, blocks, choices)),
    [manual, original, blocks, choices]
  )
  const unresolved = unresolvedCount(blocks, choices)

  const choose = (index: number, side: MergeSide) => {
    setChoices(prev => ({ ...prev, [index]: prev[index] === side ? undefined : side }))
    setManual(null)
  }

  const applyToAll = (side: MergeSide) => {
    const next: Record<number, MergeSide | undefined> = {}
    for (const block of blocks) next[block.index] = side
    setChoices(next)
    setManual(null)
  }

  const reveal = (index: number) => {
    const clamped = Math.max(0, Math.min(blocks.length - 1, index))
    setActive(clamped)
    cardRefs.current[clamped]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await window.electronAPI.fs.writeFile(`${repoPath}/${filePath}`, merged)
      // staging the file marks the conflict as resolved in git
      await window.electronAPI.git.stage(repoPath, [filePath])
      onResolved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  // Ctrl+S saves, like everywhere else in the IDE
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const lang = detectLangForMerge(filePath)
  const editorTheme = theme === 'dark' ? THEME_DARK : THEME_LIGHT

  const sidePane = (
    block: ConflictBlock,
    side: 'ours' | 'theirs',
    label: string,
    color: string,
    lines: string[],
    startLine: number
  ) => {
    const choice = choices[block.index]
    // with "both" both sides are taken, so neither is dimmed
    const selected = choice === side || choice === 'both'
    const dimmed = choice !== undefined && choice !== 'both' && choice !== side
    return (
      <div
        onClick={() => choose(block.index, side)}
        title={`clicca per prendere questa versione (${label})`}
        data-tip-desc={selected ? 'click again to leave this conflict unresolved' : 'take this side for this conflict'}
        style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          border: `1px solid ${selected ? color : 'var(--border-color)'}`,
          borderRadius: 'var(--radius-sm)', overflow: 'hidden', cursor: 'pointer',
          background: selected ? 'var(--bg-active)' : 'var(--bg-card)',
          opacity: dimmed ? 0.45 : 1,
          transition: 'opacity 0.12s ease, border-color 0.12s ease'
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px', padding: '2px 8px',
          fontSize: 'calc(8.5px * var(--ui-text-scale, 1))', fontWeight: 700, color,
          fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.4px',
          borderBottom: `1px solid ${selected ? color : 'var(--border-subtle)'}`,
          background: selected ? 'var(--bg-subtle)' : 'transparent', flexShrink: 0
        }}>
          {selected ? <Check size={10} /> : <ArrowRight size={10} style={{ opacity: 0.5 }} />}
          {label}
          <span style={{ marginLeft: 'auto', fontWeight: 500, color: 'var(--text-disabled)' }}>
            {lines.length === 0 ? 'vuoto' : `${lines.length} righe`}
          </span>
        </div>
        <div style={{ maxHeight: '190px', overflow: 'auto', padding: '3px 0' }}>
          <CodeLines lines={lines} startLine={startLine} />
        </div>
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 300, backdropFilter: 'blur(2px)'
    }}>
      <div style={{
        width: '96%', height: '94%', display: 'flex', flexDirection: 'column',
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
                background: unresolved > 0 ? 'var(--error-bg)' : 'var(--success-bg)',
                color: unresolved > 0 ? 'var(--error-color)' : 'var(--success-color)',
                fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, flexShrink: 0
              }}>
                {unresolved > 0 ? `${unresolved} conflitti` : 'risolto'}
              </span>
            )}
          </div>
          <button onClick={onClose} title="close" data-tip-desc="close this panel or dialog"
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

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px',
          borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
          flexShrink: 0, flexWrap: 'wrap'
        }}>
          {blocks.length > 0 && (
            <>
              <button onClick={() => reveal(active - 1)} title="conflitto precedente" data-tip-desc="go to the previous conflict" style={navBtnStyle}>
                <ChevronUp size={11} />
              </button>
              <button onClick={() => reveal(active + 1)} title="conflitto successivo" data-tip-desc="go to the next conflict" style={navBtnStyle}>
                <ChevronDown size={11} />
              </button>
              <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>
                {blocks.length > 0 ? `${active + 1}/${blocks.length}` : ''}
              </span>
              <span style={{ width: '1px', height: '14px', background: 'var(--border-subtle)' }} />
              <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-muted)' }}>tutti:</span>
              <ToolBtn label="prendi sx" title="risolvi tutti con la versione di sinistra (HEAD)" data-tip-desc="accept the current (HEAD) version for every conflict" onClick={() => applyToAll('ours')} color="var(--accent-color)" />
              <ToolBtn label="prendi dx" title="risolvi tutti con la versione di destra (in arrivo)" data-tip-desc="accept the incoming version for every conflict" onClick={() => applyToAll('theirs')} color="var(--warning-color)" />
              <ToolBtn label="entrambe" title="tieni entrambe le versioni (prima sx, poi dx)" data-tip-desc="keep both versions in order for every conflict" onClick={() => applyToAll('both')} color="var(--success-color)" />
            </>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={handleSave} disabled={saving || loading}
            title="scrivi il risultato e marca il conflitto come risolto" data-tip-desc="save the resolved file and stage it (Ctrl+S)"
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 14px', height: '26px',
              background: unresolved > 0 ? 'var(--accent-color)' : 'var(--success-color)',
              border: 'none', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-inverse)', cursor: saving || loading ? 'not-allowed' : 'pointer',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 600,
              opacity: saving || loading ? 0.6 : 1
            }}>
            {saving ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={11} />}
            {saving ? 'salvo…' : 'salva e risolvi'}
          </button>
        </div>

        {/* Conflicts + result */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: '1 1 56%', minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-color)' }}>
            <PaneLabel icon={<Columns2 size={11} />} text="conflitti — clicca la modifica da prendere" color="var(--text-secondary)" />
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {loading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px' }}>
                  <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
                </div>
              )}
              {!loading && blocks.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--success-color)', fontSize: 'calc(11px * var(--ui-text-scale, 1))' }}>
                  nessun conflitto da risolvere — puoi salvare direttamente
                </div>
              )}
              {blocks.map(block => {
                const choice = choices[block.index]
                const isActive = block.index === active
                const statusColor = choice === 'ours' ? 'var(--accent-color)' : choice === 'theirs' ? 'var(--warning-color)' : choice === 'both' ? 'var(--success-color)' : 'var(--error-color)'
                const statusLabel = choice === 'ours' ? 'sx' : choice === 'theirs' ? 'dx' : choice === 'both' ? 'entrambe' : 'non risolto'
                return (
                  <div key={block.index}
                    ref={(el) => { cardRefs.current[block.index] = el }}
                    onClick={() => setActive(block.index)}
                    style={{
                      border: `1px solid ${isActive ? 'var(--accent-color)' : 'var(--border-color)'}`,
                      borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)',
                      display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden'
                    }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px',
                      borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-subtle)'
                    }}>
                      <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
                        #{block.index + 1}
                      </span>
                      <span style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: 'var(--text-disabled)' }}>
                        righe {block.startLine}–{block.endLine}
                      </span>
                      <span style={{
                        marginLeft: 'auto', padding: '1px 7px', borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${statusColor}`, color: statusColor,
                        fontSize: 'calc(8.5px * var(--ui-text-scale, 1))', fontWeight: 700
                      }}>
                        {statusLabel}
                      </span>
                      <button onClick={(e) => { e.stopPropagation(); choose(block.index, 'both') }}
                        title="tieni entrambe le versioni" data-tip-desc="keep both sides for this conflict"
                        style={{ ...chipBtn, width: 'auto', padding: '0 6px', color: 'var(--success-color)', border: '1px solid var(--success-color)' }}>
                        entrambe
                      </button>
                      {choice && (
                        <button onClick={(e) => { e.stopPropagation(); choose(block.index, choice) }}
                          title="annulla la scelta" data-tip-desc="leave this conflict unresolved"
                          style={{ ...chipBtn, width: 'auto', padding: '0 6px', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                          annulla
                        </button>
                      )}
                    </div>

                    {block.contextBefore.length > 0 && (
                      <div style={{ padding: '2px 0', borderBottom: '1px solid var(--border-subtle)', opacity: 0.45 }}>
                        <CodeLines lines={block.contextBefore} startLine={block.startLine - block.contextBefore.length} />
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', padding: '8px' }}>
                      {sidePane(block, 'ours', 'sinistra · HEAD', 'var(--accent-color)', block.ours, block.oursStart)}
                      {sidePane(block, 'theirs', 'destra · in arrivo', 'var(--warning-color)', block.theirs, block.theirsStart)}
                    </div>

                    {block.contextAfter.length > 0 && (
                      <div style={{ padding: '2px 0', borderTop: '1px solid var(--border-subtle)', opacity: 0.45 }}>
                        <CodeLines lines={block.contextAfter} startLine={block.endLine + 1} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ flex: '1 1 44%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <PaneLabel icon={<FileDiff size={11} />} text={manual !== null ? 'risultato — modificato a mano' : 'risultato'} color="var(--text-secondary)" />
            <div style={{ flex: 1, minHeight: 0 }}>
              <Editor height="100%" language={lang} theme={editorTheme}
                value={merged}
                onChange={(v) => setManual(v || '')}
                onMount={(_e, monaco) => applyEditorTheme(monaco)}
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

function CodeLines({ lines, startLine }: { lines: string[]; startLine: number }) {
  if (lines.length === 0) {
    return <div style={{ padding: '4px 10px', color: 'var(--text-disabled)', fontSize: 'calc(10px * var(--ui-text-scale, 1))' }}>(vuoto)</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', minHeight: '17px' }}>
          <span style={{
            width: '42px', flexShrink: 0, textAlign: 'right', paddingRight: '8px',
            color: 'var(--text-disabled)', userSelect: 'none',
            fontSize: 'calc(9px * var(--ui-text-scale, 1))'
          }}>
            {startLine + i}
          </span>
          <span style={{
            whiteSpace: 'pre', color: 'var(--text-primary)',
            fontSize: 'calc(11px * var(--ui-text-scale, 1))', paddingRight: '8px'
          }}>
            {line || ' '}
          </span>
        </div>
      ))}
    </div>
  )
}

function PaneLabel({ icon, text, color }: { icon: React.ReactNode; text: string; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px',
      fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700,
      color, textTransform: 'uppercase', letterSpacing: '0.5px',
      fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-primary)', flexShrink: 0
    }}>
      {icon}
      {text}
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
  borderRadius: '3px', cursor: 'pointer', fontSize: '9px', fontWeight: 700,
  fontFamily: 'var(--font-mono)'
}

function ToolBtn(props: { label: string; title: string; onClick: () => void; color: string; 'data-tip-desc'?: string }) {
  const { label, title, onClick, color, 'data-tip-desc': tipDesc } = props
  return (
    <button onClick={onClick} title={title} data-tip-desc={tipDesc} style={{
      display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', height: '22px',
      background: 'var(--bg-card)', border: `1px solid ${color}`,
      borderRadius: 'var(--radius-sm)', color, cursor: 'pointer',
      fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 600, fontFamily: 'var(--font-mono)'
    }}
      onMouseEnter={(e) => { e.currentTarget.style.background = color; e.currentTarget.style.color = 'var(--text-inverse)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = color }}>
      <ArrowRight size={10} />
      {label}
    </button>
  )
}
