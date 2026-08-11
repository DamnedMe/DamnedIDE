import { useState } from 'react'
import { useSettingsStore, useToastStore, AppSettings, ThemeColorConfig, DEFAULT_DARK_COLORS, DEFAULT_LIGHT_COLORS } from '../../store'
import { PanelContainer } from '../layout/PanelContainer'
import { relativeLuminance } from '../../utils/color'
import { Settings, Sun, Moon, Type, LayoutGrid, WrapText, Indent, Save, RotateCcw, AlignLeft, TextQuote, Palette, X, ChevronLeft } from 'lucide-react'

function SettingRow({ icon, label, children }: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', background: 'var(--bg-card)',
      border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
      gap: '12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
        {icon}
        {label}
      </div>
      {children}
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
      cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-mono)',
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
      fontSize: '10px', fontFamily: 'var(--font-mono)', padding: '3px 8px',
      cursor: 'pointer', outline: 'none'
    }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function SettingsPanel() {
  const { settings, themeDefaults, updateSettings, resetSettings, setThemeDefaults, resetThemeToDefaults } = useSettingsStore()
  const showToast = useToastStore(s => s.showToast)
  const s = settings
  const [showColors, setShowColors] = useState(false)

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
    <PanelContainer title="Settings">
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        padding: '12px', gap: '8px', overflow: 'auto'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '4px 8px 10px', borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0
        }}>
          {showColors ? (
            <>
              <button onClick={() => setShowColors(false)} title="back"
                style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                <ChevronLeft size={13} />
              </button>
              <Palette size={14} style={{ color: 'var(--accent-color)' }} />
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                editor colors — {s.theme}
              </span>
            </>
          ) : (
            <>
              <Settings size={14} style={{ color: 'var(--accent-color)' }} />
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                editor settings
              </span>
            </>
          )}
        </div>

        {showColors ? (
          <>
            {colorEntries.map(entry => (
              <div key={entry.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 14px', background: 'var(--bg-card)',
                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                gap: '12px'
              }}>
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {entry.label}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input type="color" value={colors[entry.key]}
                    onChange={(e) => setColor(entry.key, e.target.value)}
                    style={{ width: '28px', height: '22px', padding: 0, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', minWidth: '52px', textAlign: 'right' }}>
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
                cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-mono)'
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-color)'; e.currentTarget.style.color = 'var(--accent-color)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
                <RotateCcw size={11} />
                reset colors
              </button>
            </div>
          </>
        ) : (
          <>
        <SettingRow icon={<Sun size={13} />} label="theme">
          <div style={{ display: 'flex', gap: '4px' }}>
            <ThemeBtn icon={<Moon size={11} />} label="dark" active={s.theme === 'dark'} onClick={() => updateSettings({ theme: 'dark' })} />
            <ThemeBtn icon={<Sun size={11} />} label="light" active={s.theme === 'light'} onClick={() => updateSettings({ theme: 'light' })} />
          </div>
        </SettingRow>

        <SettingRow icon={<Palette size={13} />} label="primary color">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="color" value={s.accentColor} onChange={(e) => handleAccentChange(e.target.value)}
              title="primary color (indipendente dal tema)"
              style={{ width: '28px', height: '22px', padding: 0, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', minWidth: '62px', textAlign: 'right' }}>
              {s.accentColor}
            </span>
          </div>
        </SettingRow>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button onClick={() => { setThemeDefaults(); showToast('tema corrente salvato come standard') }}
            title="salva colore primario e colori editor correnti come standard"
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', height: '28px',
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-mono)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-color)'; e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
            <Save size={11} /> set current as standard theme
          </button>
          <button onClick={() => { resetThemeToDefaults(); showToast('tema ripristinato allo standard') }}
            title="ripristina colore primario e colori editor allo standard salvato"
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', height: '28px',
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-mono)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--warning-color)'; e.currentTarget.style.color = 'var(--warning-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
            <RotateCcw size={11} /> reset default theme settings
          </button>
        </div>

        <SettingRow icon={<Type size={13} />} label="font size">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="range" min="8" max="24" step="0.5" value={s.fontSize}
              onChange={(e) => updateSettings({ fontSize: parseFloat(e.target.value) })}
              style={{ width: '100px', accentColor: 'var(--accent-color)' }}
            />
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--accent-color)', minWidth: '28px', textAlign: 'right' }}>
              {s.fontSize}px
            </span>
          </div>
        </SettingRow>

        <SettingRow icon={<LayoutGrid size={13} />} label="minimap">
          <Toggle checked={s.minimap} onChange={(v) => updateSettings({ minimap: v })} />
        </SettingRow>

        <SettingRow icon={<Indent size={13} />} label="tab size">
          <SelectInput value={String(s.tabSize)} onChange={(v) => updateSettings({ tabSize: parseInt(v) })} options={[
            { value: '2', label: '2 spaces' },
            { value: '4', label: '4 spaces' },
            { value: '8', label: '8 spaces' }
          ]} />
        </SettingRow>

        <SettingRow icon={<AlignLeft size={13} />} label="line numbers">
          <SelectInput value={s.lineNumbers} onChange={(v) => updateSettings({ lineNumbers: v as 'on' | 'off' | 'relative' })} options={[
            { value: 'on', label: 'on' },
            { value: 'off', label: 'off' },
            { value: 'relative', label: 'relative' }
          ]} />
        </SettingRow>

        <SettingRow icon={<WrapText size={13} />} label="word wrap">
          <Toggle checked={s.wordWrap === 'on'} onChange={(v) => updateSettings({ wordWrap: v ? 'on' : 'off' })} />
        </SettingRow>

        <SettingRow icon={<TextQuote size={13} />} label="font ligatures">
          <Toggle checked={s.fontLigatures} onChange={(v) => updateSettings({ fontLigatures: v })} />
        </SettingRow>

        <SettingRow icon={<Save size={13} />} label="auto save">
          <Toggle checked={s.autoSave} onChange={(v) => updateSettings({ autoSave: v })} />
        </SettingRow>

        <SettingRow icon={<ChevronLeft size={13} />} label="navigation keybindings">
          <SelectInput value={s.navKeybindings} onChange={(v) => updateSettings({ navKeybindings: v as 'vs-studio' | 'vs-code' })} options={[
            { value: 'vs-studio', label: 'VS Studio — Ctrl+- / Ctrl+Shift+-' },
            { value: 'vs-code', label: 'VS Code — Alt+Left / Alt+Right' }
          ]} />
        </SettingRow>

        <button onClick={() => setShowColors(true)} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '8px 14px', height: '32px',
          background: 'var(--accent-bg)', border: '1px solid var(--accent-color)',
          borderRadius: 'var(--radius-md)', color: 'var(--accent-color)',
          cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 600
        }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-color)'; e.currentTarget.style.color = 'var(--text-inverse)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-bg)'; e.currentTarget.style.color = 'var(--accent-color)' }}>
          <Palette size={12} />
          Configurazione editor
        </button>

        <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={resetSettings} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '5px 14px', height: '28px',
            background: 'var(--bg-card)', border: '1px solid var(--error-color)',
            borderRadius: 'var(--radius-sm)', color: 'var(--error-color)',
            cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-mono)'
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--error-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)' }}>
            <RotateCcw size={11} />
            reset to defaults
          </button>
        </div>
        </>
        )}
      </div>
    </PanelContainer>
  )
}
