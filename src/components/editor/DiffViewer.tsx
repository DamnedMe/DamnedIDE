import { useRef, forwardRef, useImperativeHandle, useEffect } from 'react'
import { DiffEditor, DiffOnMount } from '@monaco-editor/react'
import { Columns2, Rows3, X, Maximize2 } from 'lucide-react'
import { ZoomControls } from './CodeEditor'
import { defineThemes, THEME_DARK, THEME_LIGHT, patchCSharpGrammar } from './monaco-theme'
import { useUIStore, useSettingsStore, useDiffStore } from '../../store'
import { registerCSharpHover, trackHoverModel } from '../../utils/csharp-hover'

export interface DiffViewerHandle {
  getVisibleLine: () => number | null
  getScrollLine: () => number | null
}

interface DiffViewerProps {
  original: string
  modified: string
  language?: string
  filePath?: string
  onClose?: () => void
  onPopOut?: () => void
  onVisibleLineChange?: (line: number) => void
  initialLine?: number
}

export const DiffViewer = forwardRef<DiffViewerHandle, DiffViewerProps>(function DiffViewer({ original, modified, language, filePath, onClose, onPopOut, onVisibleLineChange, initialLine }, ref) {
  // zoom and view type are persisted so they survive file switches (diff remounts)
  const sideBySide = useDiffStore(s => s.sideBySide)
  const setSideBySide = useDiffStore(s => s.setSideBySide)
  const fontSize = useDiffStore(s => s.fontSize)
  const setFontSize = useDiffStore(s => s.setFontSize)
  const diffEditorRef = useRef<Parameters<DiffOnMount>[0] | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const theme = useUIStore(s => s.theme)
  const themeColors = useSettingsStore(s => s.settings.themeColors)

  const applyEditorTheme = (monaco: typeof import('monaco-editor')) => {
    defineThemes(monaco, themeColors)
    patchCSharpGrammar(monaco)
    monaco.editor.setTheme(theme === 'dark' ? THEME_DARK : THEME_LIGHT)
  }

  useEffect(() => {
    if (monacoRef.current) applyEditorTheme(monacoRef.current)
  }, [theme, themeColors])

  const updateFontSize = (f: number) => {
    const d = diffEditorRef.current
    d?.getModifiedEditor()?.updateOptions({ fontSize: f })
    d?.getOriginalEditor()?.updateOptions({ fontSize: f })
  }

  const zoomIn = () => { const f = Math.min(fontSize + 1, 28); setFontSize(f); updateFontSize(f) }
  const zoomOut = () => { const f = Math.max(fontSize - 1, 6); setFontSize(f); updateFontSize(f) }
  const zoomReset = () => { setFontSize(12.5); updateFontSize(12.5) }

  const handleDiffMount: DiffOnMount = (editor, monaco) => {
    diffEditorRef.current = editor
    monacoRef.current = monaco
    applyEditorTheme(monaco)
    registerCSharpHover(monaco)
    if (filePath) {
      const modEd = editor.getModifiedEditor()
      const origEd = editor.getOriginalEditor()
      trackHoverModel(modEd?.getModel(), filePath)
      trackHoverModel(origEd?.getModel(), filePath)
      // model swaps (e.g. inline/side toggle) → re-track
      modEd?.onDidChangeModel(() => trackHoverModel(modEd.getModel(), filePath))
      origEd?.onDidChangeModel(() => trackHoverModel(origEd.getModel(), filePath))
    }
    const addCmd = (mod: typeof monaco) => {
      const modEd = editor.getModifiedEditor()
      const origEd = editor.getOriginalEditor()
      if (!modEd || !origEd) return
      modEd.addCommand(mod.KeyMod.CtrlCmd | mod.KeyCode.Equal, zoomIn)
      modEd.addCommand(mod.KeyMod.CtrlCmd | mod.KeyCode.Minus, zoomOut)
      modEd.addCommand(mod.KeyMod.CtrlCmd | mod.KeyCode.Digit0, zoomReset)
      origEd.addCommand(mod.KeyMod.CtrlCmd | mod.KeyCode.Equal, zoomIn)
      origEd.addCommand(mod.KeyMod.CtrlCmd | mod.KeyCode.Minus, zoomOut)
      origEd.addCommand(mod.KeyMod.CtrlCmd | mod.KeyCode.Digit0, zoomReset)
    }
    addCmd(monaco)
    if (onVisibleLineChange) {
      const modEd = editor.getModifiedEditor()
      modEd?.onDidScrollChange(() => {
        const line = modEd.getVisibleRanges()?.[0]?.startLineNumber ?? null
        if (line != null) onVisibleLineChange(line)
      })
    }
    if (initialLine) {
      // reveal only when the viewport is real and the model has enough lines
      // (at mount the container can be collapsed, making the reveal a no-op)
      const modEd = editor.getModifiedEditor()
      let tries = 0
      const attempt = () => {
        if (!modEd) return
        try {
          const vr = modEd.getVisibleRanges()?.[0]
          const viewReady = !!vr && (vr.endLineNumber - vr.startLineNumber) >= 4
          const modelReady = (modEd.getModel()?.getLineCount() ?? 0) >= initialLine
          if ((viewReady && modelReady) || tries > 30) {
            // reveal at the TOP so a previously-scrolled file resumes where it
            // was left (scroll position is line-based, per file)
            modEd.revealLine(initialLine, monaco.ScrollType.Immediate)
            modEd.setPosition({ lineNumber: initialLine, column: 1 })
          } else {
            tries++
            setTimeout(attempt, 60)
          }
        } catch { /* ignore */ }
      }
      attempt()
    }
  }

  useImperativeHandle(ref, () => ({
    getVisibleLine: () => {
      const modEd = diffEditorRef.current?.getModifiedEditor()
      // prefer the cursor line (where the user is actually working)
      const pos = modEd?.getPosition()
      if (pos?.lineNumber) return pos.lineNumber
      return modEd?.getVisibleRanges()?.[0]?.startLineNumber ?? null
    },
    getScrollLine: () => {
      // the line at the TOP of the viewport = the actual scroll position
      return diffEditorRef.current?.getModifiedEditor()?.getVisibleRanges()?.[0]?.startLineNumber ?? null
    }
  }))

  const detectLanguage = (path?: string): string => {
    if (!path) return 'plaintext'
    const ext = path.split('.').pop()?.toLowerCase()
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      cs: 'csharp', csproj: 'xml', sln: 'plaintext',
      json: 'json', xml: 'xml', html: 'html', css: 'css', scss: 'scss',
      sql: 'sql', md: 'markdown', yaml: 'yaml', yml: 'yaml',
      py: 'python', rs: 'rust', go: 'go', java: 'java',
      ps1: 'powershell', sh: 'shell', bat: 'bat',
      gitignore: 'plaintext', dockerfile: 'dockerfile'
    }
    return map[ext || ''] || 'plaintext'
  }

  const lang = language || detectLanguage(filePath)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-card)', overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 8px', borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-primary)', flexShrink: 0
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          fontSize: '10px', fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)', overflow: 'hidden'
        }}>
          {filePath && (
            <>
              <span style={{
                padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                background: 'var(--success-bg)', color: 'var(--success-color)',
                fontWeight: 700, fontSize: '9px', flexShrink: 0
              }}>
                + added
              </span>
              <span style={{
                padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                background: 'var(--error-bg)', color: 'var(--error-color)',
                fontWeight: 700, fontSize: '9px', flexShrink: 0
              }}>
                − removed
              </span>
              <span style={{
                color: 'var(--text-primary)', fontWeight: 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {filePath}
              </span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
          <ToggleButton
            active={sideBySide}
            onClick={() => setSideBySide(true)}
            title="side by side"
            icon={<Columns2 size={12} />}
          />
          <ToggleButton
            active={!sideBySide}
            onClick={() => setSideBySide(false)}
            title="inline"
            icon={<Rows3 size={12} />}
          />
          {onPopOut && (
            <button
              onClick={onPopOut}
              title="open in full screen"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '24px', height: '20px', marginLeft: '2px',
                background: 'transparent', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
                cursor: 'pointer', transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)'; e.currentTarget.style.borderColor = 'var(--accent-color)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}
            >
              <Maximize2 size={11} />
            </button>
          )}
          <ZoomControls fontSize={fontSize} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={zoomReset} />
          {onClose && (
            <button
              onClick={onClose}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '22px', height: '22px', marginLeft: '4px',
                background: 'transparent', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
                cursor: 'pointer', transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--error-color)'
                e.currentTarget.style.borderColor = 'var(--error-color)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)'
                e.currentTarget.style.borderColor = 'var(--border-color)'
              }}
              title="close"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffEditor
          height="100%"
          language={lang}
          theme={theme === 'dark' ? THEME_DARK : THEME_LIGHT}
          original={original}
          modified={modified}
          onMount={handleDiffMount}
          options={{
            fontSize,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
            fontLigatures: false,
            mouseWheelZoom: true,
            lineNumbers: 'on',
            renderSideBySide: sideBySide,
            useInlineViewWhenSpaceIsLimited: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            readOnly: true,
            originalEditable: false,
            padding: { top: 8, bottom: 4 },
            hover: { enabled: 'on', delay: 500 },
            renderOverviewRuler: true,
            hideUnchangedRegions: {
              enabled: true,
              revealLineCount: 2,
              minimumLineCount: 4,
              contextLineCount: 3
            },
            diffWordWrap: 'off',
            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
          }}
        />
      </div>
    </div>
  )
})

function ToggleButton({ active, onClick, title, icon }: {
  active: boolean
  onClick: () => void
  title: string
  icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '24px', height: '20px',
        background: active ? 'var(--bg-active)' : 'transparent',
        border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`,
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--accent-color)' : 'var(--text-muted)',
        cursor: 'pointer', transition: 'all 0.15s ease'
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = 'var(--text-muted)'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = 'var(--border-color)'
          e.currentTarget.style.color = 'var(--text-muted)'
        }
      }}
    >
      {icon}
    </button>
  )
}
