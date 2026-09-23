import { useEffect, useState } from 'react'
import { useSettingsStore, useToastStore, useWorktreeStore, AppSettings, ThemeColorConfig, DEFAULT_DARK_COLORS, DEFAULT_LIGHT_COLORS } from '../../store'
import { PanelContainer } from '../layout/PanelContainer'
import { relativeLuminance } from '../../utils/color'
import { useI18n } from '../../i18n'
import { Settings, Sun, Moon, Type, LayoutGrid, WrapText, Indent, Save, RotateCcw, AlignLeft, TextQuote, Palette, X, ChevronLeft, Languages, Images, SlidersHorizontal, PenLine, Globe, PlugZap, Bot, Plus, Trash2, RefreshCw, Loader2, AlertCircle, Check, Download } from 'lucide-react'
import { McpPanel } from '../mcp/McpPanel'
import { AgentSettings } from './AgentSettings'
import { TerminalDock } from '../terminal/TerminalDock'
import { useAiChatStore } from '../../store'

function SettingRow({ icon, label, children }: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '9px 12px', background: 'var(--bg-card)',
      border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
      gap: '12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
        {icon}
        {label}
      </div>
      {children}
    </div>
  )
}

function Section({ title, icon, children }: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 2px 0',
        fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--accent-color)',
        textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-mono)'
      }}>
        {icon}
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {children}
      </div>
    </div>
  )
}

function ThemeBtn({ icon, label, active, onClick }: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '5px 14px', height: '28px',
      background: active ? 'var(--accent-bg)' : 'var(--bg-subtle)',
      border: active ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
      borderRadius: 'var(--radius-sm)',
      color: active ? 'var(--accent-color)' : 'var(--text-muted)',
      cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
      fontWeight: active ? 600 : 500, transition: 'all 0.15s ease'
    }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--text-muted)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--border-color)' }}>
      {icon}
      {label}
    </button>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
      width: '32px', height: '16px', borderRadius: '10px', border: 'none',
      background: checked ? 'var(--accent-color)' : 'var(--bg-subtle)',
      cursor: 'pointer', transition: 'background 0.15s ease', flexShrink: 0
    }}>
      <div style={{
        width: '12px', height: '12px', borderRadius: '50%',
        background: checked ? 'var(--text-inverse)' : 'var(--text-muted)',
        marginLeft: checked ? '18px' : '2px',
        transition: 'margin 0.15s ease, background 0.15s ease'
      }} />
    </button>
  )
}

function SelectInput({ value, options, onChange }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{
      background: 'var(--bg-input)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
      fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', padding: '3px 8px',
      cursor: 'pointer', outline: 'none'
    }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function SettingsPanel() {
  const { settings, themeDefaults, updateSettings, resetSettings, setThemeDefaults, resetThemeToDefaults } = useSettingsStore()
  const showToast = useToastStore(s => s.showToast)
  // the terminal dock lives here too, so "accedi" (agent login) is visible without
  // switching panel
  const dockRepoPath = useWorktreeStore(s => s.selectedWorktree)
  const s = settings
  const [showColors, setShowColors] = useState(false)
  const [showMcp, setShowMcp] = useState(false)
  const [showAgents, setShowAgents] = useState(false)
  const aiRules = useAiChatStore(s => s.rules)
  const addAiRule = useAiChatStore(s => s.addRule)
  const removeAiRule = useAiChatStore(s => s.removeRule)
  const [newRule, setNewRule] = useState('')
  const t = useI18n()

  // ─── OTA: current version + manual check, kept in sync with the main process ─
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)

  useEffect(() => {
    window.electronAPI.updater.state().then(setUpdate).catch(() => { /* main not ready */ })
    return window.electronAPI.updater.onState(setUpdate)
  }, [])

  const checkUpdates = async () => {
    setCheckingUpdates(true)
    try {
      const st = await window.electronAPI.updater.check()
      setUpdate(st)
      if (!st.packaged) showToast('gli aggiornamenti OTA valgono solo per la versione installata', 'info')
      else if (st.status === 'up-to-date') showToast('sei già alla versione più recente')
      else if (st.status === 'error') showToast(st.error || 'verifica aggiornamenti fallita', 'error')
      else if (st.status === 'available') showToast(`nuova versione ${st.version} in scaricamento`)
    } catch (e) {
      showToast((e as Error).message || 'verifica aggiornamenti fallita', 'error')
    } finally {
      setCheckingUpdates(false)
    }
  }

  const updateBusy = checkingUpdates || update?.status === 'checking' || update?.status === 'downloading'
  const updateStatusText = (st: UpdateState | null): string => {
    if (!st) return '…'
    if (!st.packaged) return "versione di sviluppo: gli aggiornamenti OTA sono attivi solo nell'app installata"
    switch (st.status) {
      case 'idle': return `versione installata ${st.currentVersion}`
      case 'checking': return 'verifica in corso…'
      case 'available': return `nuova versione ${st.version} disponibile — avvio scaricamento…`
      case 'downloading': return `scaricamento ${st.version ?? ''}… ${st.progress ?? 0}%`
      case 'downloaded': return `versione ${st.version} pronta — riavvia per installarla`
      case 'up-to-date': return `sei alla versione più recente (${st.currentVersion})`
      case 'error': return `errore: ${st.error || 'verifica non riuscita'}`
    }
  }
  const updateStatusColor =
    update?.status === 'up-to-date' || update?.status === 'downloaded' ? 'var(--success-color)'
      : update?.status === 'error' ? 'var(--error-color)'
        : 'var(--text-muted)'

  // Primary color is independent of the theme, but black/near-black is blocked on the
  // dark theme and white/near-white on the light theme (otherwise it would be invisible).
  const handleAccentChange = (value: string) => {
    const lum = relativeLuminance(value)
    const isDark = s.theme === 'dark'
    if ((isDark && lum < 0.08) || (!isDark && lum > 0.92)) {
      showToast(isDark ? 'colore troppo scuro per il tema scuro (bloccato)' : 'colore troppo chiaro per il tema chiaro (bloccato)', 'error')
      return
    }
    updateSettings({ accentColor: value })
  }

  const setColor = (key: keyof ThemeColorConfig, value: string) => {
    const palette = s.theme === 'dark' ? 'dark' : 'light'
    const nextColors = { ...s.themeColors[palette], [key]: value }
    updateSettings({ themeColors: { ...s.themeColors, [palette]: nextColors } })
  }

  const resetColors = () => {
    const palette = s.theme === 'dark' ? 'dark' : 'light'
    const defaults = palette === 'dark' ? DEFAULT_DARK_COLORS : DEFAULT_LIGHT_COLORS
    updateSettings({ themeColors: { ...s.themeColors, [palette]: { ...defaults } } })
  }

  const colors = s.theme === 'dark' ? s.themeColors.dark : s.themeColors.light
  const colorEntries: { key: keyof ThemeColorConfig; label: string }[] = [
    { key: 'keyword', label: 'keywords / declarations' },
    { key: 'controlFlow', label: 'control flow' },
    { key: 'linq', label: 'linq' },
    { key: 'type', label: 'types' },
    { key: 'method', label: 'methods' },
    { key: 'staticClass', label: 'static classes' },
    { key: 'identifier', label: 'identifiers / variables' },
    { key: 'namespace', label: 'namespaces' },
    { key: 'number', label: 'numbers' },
    { key: 'string', label: 'strings' },
    { key: 'comment', label: 'comments' },
    { key: 'delimiter', label: 'operators / delimiters' }
  ]

  return (
    <PanelContainer>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        padding: '12px', gap: '8px', overflow: 'auto'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '4px 8px 10px', borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0
        }}>
          {showAgents ? (
            <>
              <button onClick={() => setShowAgents(false)} title="back" data-tip-desc="go back to the previous view"
                style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                <ChevronLeft size={13} />
              </button>
              <Bot size={14} style={{ color: 'var(--accent-color)' }} />
              <span style={{ fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {t('AI agents')}
              </span>
            </>
          ) : showMcp ? (
            <>
              <button onClick={() => setShowMcp(false)} title="back" data-tip-desc="go back to the previous view"
                style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                <ChevronLeft size={13} />
              </button>
              <PlugZap size={14} style={{ color: 'var(--accent-color)' }} />
              <span style={{ fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                Strumenti MCP
              </span>
            </>
          ) : showColors ? (
            <>
              <button onClick={() => setShowColors(false)} title="back" data-tip-desc="go back to the previous view"
                style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                <ChevronLeft size={13} />
              </button>
              <Palette size={14} style={{ color: 'var(--accent-color)' }} />
              <span style={{ fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {t('editor colors')} — {s.theme}
              </span>
            </>
          ) : (
            <>
              <Settings size={14} style={{ color: 'var(--accent-color)' }} />
              <span style={{ fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {t('settings')}
              </span>
            </>
          )}
        </div>

        {showAgents ? (
          <AgentSettings />
        ) : showMcp ? (
          <McpPanel />
        ) : showColors ? (
          <>
            {colorEntries.map(entry => (
              <div key={entry.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 14px', background: 'var(--bg-card)',
                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                gap: '12px'
              }}>
                <span style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {entry.label}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input type="color" value={colors[entry.key]}
                    onChange={(e) => setColor(entry.key, e.target.value)}
                    style={{ width: '28px', height: '22px', padding: 0, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', minWidth: '52px', textAlign: 'right' }}>
                    {colors[entry.key]}
                  </span>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '6px' }}>
              <button onClick={resetColors} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '5px 14px', height: '28px',
                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-color)'; e.currentTarget.style.color = 'var(--accent-color)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
                <RotateCcw size={11} />
                {t('reset colors')}
              </button>
            </div>
          </>
        ) : (
          <>
            <Section title="updates" data-tip-desc="check for and install new versions of the IDE" icon={<RefreshCw size={11} />}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', background: 'var(--bg-card)',
                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', gap: '12px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span style={{ display: 'flex', color: updateStatusColor, flexShrink: 0 }}>
                    {update?.status === 'checking' || update?.status === 'downloading' || checkingUpdates
                      ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                      : update?.status === 'error' ? <AlertCircle size={14} />
                        : update?.status === 'up-to-date' || update?.status === 'downloaded' ? <Check size={14} />
                          : <RefreshCw size={14} />}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      DamnedIDE {update?.currentVersion || '…'}
                    </div>
                    <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', color: updateStatusColor, fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                      {updateStatusText(update)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button onClick={checkUpdates} disabled={updateBusy}
                    title="verifica la disponibilità di aggiornamenti" data-tip-desc="check GitHub releases for a newer version"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', height: '28px',
                      background: 'var(--bg-subtle)', border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)', color: updateBusy ? 'var(--text-muted)' : 'var(--text-secondary)',
                      cursor: updateBusy ? 'not-allowed' : 'pointer',
                      fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                    }}>
                    {updateBusy ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={11} />}
                    verifica aggiornamenti
                  </button>
                  {update?.status === 'downloaded' && (
                    <button onClick={() => window.electronAPI.updater.install()}
                      title="riavvia e installa l'aggiornamento" data-tip-desc="quit and install the downloaded update"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', height: '28px',
                        background: 'var(--accent-color)', border: 'none', borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-inverse)', cursor: 'pointer',
                        fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                      }}>
                      <Download size={11} />
                      riavvia e aggiorna
                    </button>
                  )}
                </div>
              </div>
            </Section>

            <Section title="appearance" data-tip-desc="interface appearance options" icon={<SlidersHorizontal size={11} />}>
              <SettingRow icon={<Sun size={13} />} label={t('theme')}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <ThemeBtn icon={<Moon size={11} />} label={t('dark')} active={s.theme === 'dark'} onClick={() => updateSettings({ theme: 'dark' })} />
                  <ThemeBtn icon={<Sun size={11} />} label={t('light')} active={s.theme === 'light'} onClick={() => updateSettings({ theme: 'light' })} />
                </div>
              </SettingRow>

              <SettingRow icon={<Palette size={13} />} label={t('primary color')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input type="color" value={s.accentColor} onChange={(e) => handleAccentChange(e.target.value)}
                    title="primary color (indipendente dal tema)" data-tip-desc="accent color used across the IDE (independent of the theme)"
                    style={{ width: '28px', height: '22px', padding: 0, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', minWidth: '62px', textAlign: 'right' }}>
                    {s.accentColor}
                  </span>
                </div>
              </SettingRow>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button onClick={() => { setThemeDefaults(); showToast('tema corrente salvato come standard') }}
                  title="salva colore primario e colori editor correnti come standard" data-tip-desc="save the current accent color and editor colors as the standard theme"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', height: '28px',
                    background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
                    cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-color)'; e.currentTarget.style.color = 'var(--accent-color)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
                  <Save size={11} /> {t('set current as standard theme')}
                </button>
                <button onClick={() => { resetThemeToDefaults(); showToast('tema ripristinato allo standard') }}
                  title="ripristina colore primario e colori editor allo standard salvato" data-tip-desc="restore the accent color and editor colors to the saved standard"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', height: '28px',
                    background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
                    cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--warning-color)'; e.currentTarget.style.color = 'var(--warning-color)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
                  <RotateCcw size={11} /> {t('reset default theme settings')}
                </button>
              </div>

              <SettingRow icon={<Images size={13} />} label={t('icon size')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="range" min="10" max="20" step="1" value={s.iconSize}
                    onChange={(e) => updateSettings({ iconSize: parseInt(e.target.value) })}
                    style={{ width: '100px', accentColor: 'var(--accent-color)' }}
                  />
                  <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--accent-color)', minWidth: '28px', textAlign: 'right' }}>
                    {s.iconSize}px
                  </span>
                </div>
              </SettingRow>
            </Section>

            <Section title="editor" data-tip-desc="code editor panel" icon={<PenLine size={11} />}>
              <SettingRow icon={<Type size={13} />} label={t('font size')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="range" min="8" max="24" step="0.5" value={s.fontSize}
                    onChange={(e) => updateSettings({ fontSize: parseFloat(e.target.value) })}
                    style={{ width: '100px', accentColor: 'var(--accent-color)' }}
                  />
                  <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--accent-color)', minWidth: '28px', textAlign: 'right' }}>
                    {s.fontSize}px
                  </span>
                </div>
              </SettingRow>

              <SettingRow icon={<LayoutGrid size={13} />} label={t('minimap')}>
                <Toggle checked={s.minimap} onChange={(v) => updateSettings({ minimap: v })} />
              </SettingRow>

              <SettingRow icon={<Indent size={13} />} label={t('tab size')}>
                <SelectInput value={String(s.tabSize)} onChange={(v) => updateSettings({ tabSize: parseInt(v) })} options={[
                  { value: '2', label: t('2 spaces') },
                  { value: '4', label: t('4 spaces') },
                  { value: '8', label: t('8 spaces') }
                ]} />
              </SettingRow>

              <SettingRow icon={<AlignLeft size={13} />} label={t('line numbers')}>
                <SelectInput value={s.lineNumbers} onChange={(v) => updateSettings({ lineNumbers: v as 'on' | 'off' | 'relative' })} options={[
                  { value: 'on', label: t('on') },
                  { value: 'off', label: t('off') },
                  { value: 'relative', label: t('relative') }
                ]} />
              </SettingRow>

              <SettingRow icon={<WrapText size={13} />} label={t('word wrap')}>
                <Toggle checked={s.wordWrap === 'on'} onChange={(v) => updateSettings({ wordWrap: v ? 'on' : 'off' })} />
              </SettingRow>

              <SettingRow icon={<TextQuote size={13} />} label={t('font ligatures')}>
                <Toggle checked={s.fontLigatures} onChange={(v) => updateSettings({ fontLigatures: v })} />
              </SettingRow>

              <SettingRow icon={<Save size={13} />} label={t('auto save')}>
                <Toggle checked={s.autoSave} onChange={(v) => updateSettings({ autoSave: v })} />
              </SettingRow>

              <SettingRow icon={<ChevronLeft size={13} />} label={t('navigation keybindings')}>
                <SelectInput value={s.navKeybindings} onChange={(v) => updateSettings({ navKeybindings: v as 'vs-studio' | 'vs-code' })} options={[
                  { value: 'vs-studio', label: t('VS Studio — Ctrl+- / Ctrl+Shift+-') },
                  { value: 'vs-code', label: t('VS Code — Alt+Left / Alt+Right') }
                ]} />
              </SettingRow>

              <button onClick={() => setShowColors(true)} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', height: '32px',
                background: 'var(--accent-bg)', border: '1px solid var(--accent-color)',
                borderRadius: 'var(--radius-md)', color: 'var(--accent-color)',
                cursor: 'pointer', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-color)'; e.currentTarget.style.color = 'var(--text-inverse)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-bg)'; e.currentTarget.style.color = 'var(--accent-color)' }}>
                <Palette size={12} />
                {t('editor colors')}
              </button>
            </Section>

            <Section title="ai" data-tip-desc="AI agents and tool servers" icon={<Bot size={11} />}>
              <button onClick={() => setShowAgents(true)} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', height: '32px',
                background: 'var(--accent-bg)', border: '1px solid var(--accent-color)',
                borderRadius: 'var(--radius-md)', color: 'var(--accent-color)',
                cursor: 'pointer', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-color)'; e.currentTarget.style.color = 'var(--text-inverse)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-bg)'; e.currentTarget.style.color = 'var(--accent-color)' }}>
                <Bot size={12} />
                {t('AI agents')} — Claude, Codex, Cursor, opencode
              </button>
              <button onClick={() => setShowMcp(true)} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', height: '32px',
                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-color)'; e.currentTarget.style.color = 'var(--accent-color)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
                <PlugZap size={12} />
                Server MCP (client di strumenti)
              </button>
            </Section>

            <Section title="general" data-tip-desc="general IDE options" icon={<Globe size={11} />}>
              <SettingRow icon={<Languages size={13} />} label={t('language')}>
                <SelectInput value={s.language} onChange={(v) => updateSettings({ language: v as 'en' | 'it' })} options={[
                  { value: 'en', label: 'English' },
                  { value: 'it', label: 'Italiano' }
                ]} />
              </SettingRow>
            </Section>

            <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
              <button onClick={resetSettings} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '5px 14px', height: '28px',
                background: 'var(--bg-card)', border: '1px solid var(--error-color)',
                borderRadius: 'var(--radius-sm)', color: 'var(--error-color)',
                cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--error-bg)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)' }}>
                <RotateCcw size={11} />
                {t('reset to defaults')}
              </button>
            </div>
          </>
        )}
      </div>
      <TerminalDock repoPath={dockRepoPath} />
      </div>
    </PanelContainer>
  )
}
