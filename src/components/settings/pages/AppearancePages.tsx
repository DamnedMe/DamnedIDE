import { useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronRight, Columns2, Images, Moon, Palette, Plus, RotateCcw, Save, Sun, Type, X } from '@/components/icons'
import { useSettingsStore, useToastStore, DEFAULT_DARK_COLORS, DEFAULT_LIGHT_COLORS } from '../../../store'
import type { SettingsPageId, ThemeColorConfig } from '../../../store'
import { relativeLuminance } from '../../../utils/color'
import { APP_FONT_CHOICES, DEFAULT_APP_FONT } from '../../../utils/fonts'
import { useI18n } from '../../../i18n'
import { Btn, Card, CardBody, ColorInput, RangeInput, Row, SelectInput, ThemeBtn, inputStyle, px } from '../ui'

// ─── Tema: dark/light, primary color, the saved "standard theme" ───

export function ThemePage({ onOpenPage }: { onOpenPage: (page: SettingsPageId) => void }) {
  const s = useSettingsStore(st => st.settings)
  const { updateSettings, setThemeDefaults, resetThemeToDefaults } = useSettingsStore()
  const showToast = useToastStore(st => st.showToast)
  const t = useI18n()

  // Primary color is independent of the theme, but black/near-black is blocked on the
  // dark theme and white/near-white on the light theme (otherwise it would be invisible).
  const handleAccentChange = (value: string) => {
    const lum = relativeLuminance(value)
    const isDark = s.theme === 'dark'
    if ((isDark && lum < 0.08) || (!isDark && lum > 0.92)) {
      showToast(isDark ? t('color too dark for the dark theme (blocked)') : t('color too light for the light theme (blocked)'), 'error')
      return
    }
    updateSettings({ accentColor: value })
  }

  return (
    <>
      <Card>
        <Row icon={<Sun size={13} />} label={t('theme')} hint={t('background, text and borders of the whole IDE')}>
          <div style={{ display: 'flex', gap: '4px' }}>
            <ThemeBtn icon={<Moon size={11} />} label={t('dark')} active={s.theme === 'dark'} onClick={() => updateSettings({ theme: 'dark' })} />
            <ThemeBtn icon={<Sun size={11} />} label={t('light')} active={s.theme === 'light'} onClick={() => updateSettings({ theme: 'light' })} />
          </div>
        </Row>
        <Row icon={<Columns2 size={13} />} label={t('side menu')} hint={t('side of worktree, explorer, branches, DevOps lists and SQL explorer')}>
          <div style={{ display: 'flex', gap: '4px' }}>
            <ThemeBtn icon={<ArrowLeft size={11} />} label={t('left side')} active={s.sidebarSide !== 'right'} onClick={() => updateSettings({ sidebarSide: 'left' })} />
            <ThemeBtn icon={<ArrowRight size={11} />} label={t('right side')} active={s.sidebarSide === 'right'} onClick={() => updateSettings({ sidebarSide: 'right' })} />
          </div>
        </Row>
        <Row icon={<Palette size={13} />} label={t('primary color')} hint={t('highlights, buttons and selections; independent of the theme')}>
          <ColorInput value={s.accentColor} onChange={handleAccentChange}
            title={t('primary color (independent of the theme)')} tip={t('accent color used across the IDE (independent of the theme)')} />
        </Row>
        <Row icon={<Palette size={13} />} label={t('editor colors')} hint={t('syntax colors for the {theme} theme', { theme: s.theme === 'dark' ? t('dark') : t('light') })}>
          <Btn onClick={() => onOpenPage('colors')} title={t('open the syntax colors')} data-tip-desc={t('Appearance › Colors')}>
            {t('edit')} <ChevronRight size={11} />
          </Btn>
        </Row>
      </Card>

      <Card title={t('Standard theme')} icon={<Save size={12} />}
        description={t('the primary color and the editor colors saved as a reference: go back to them whenever you want')}>
        <CardBody>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <Btn onClick={() => { setThemeDefaults(); showToast(t('current theme saved as standard')) }}
              title={t('save the current primary color and editor colors as standard')}
              data-tip-desc={t('save the current accent color and editor colors as the standard theme')}>
              <Save size={11} /> {t('set current as standard theme')}
            </Btn>
            <Btn onClick={() => { resetThemeToDefaults(); showToast(t('theme restored to the standard')) }}
              title={t('restore the primary color and editor colors to the saved standard')}
              data-tip-desc={t('restore the accent color and editor colors to the saved standard')}>
              <RotateCcw size={11} /> {t('reset default theme settings')}
            </Btn>
          </div>
        </CardBody>
      </Card>
    </>
  )
}

// ─── Testo e icone: IDE text size, icon size, interface font (+ custom families) ───

export function TextPage() {
  const s = useSettingsStore(st => st.settings)
  const updateSettings = useSettingsStore(st => st.updateSettings)
  const showToast = useToastStore(st => st.showToast)
  const [newFont, setNewFont] = useState('')
  const t = useI18n()

  const fontChoices = [
    ...APP_FONT_CHOICES.map(c => ({
      value: c.value,
      label: c.value === DEFAULT_APP_FONT
        ? `${c.label} (${t('default')})`
        : c.value === 'JetBrains Mono' ? `${c.label} (${t('current')})` : c.label
    })),
    ...s.customFonts.map(f => ({ value: f, label: f }))
  ]

  const addCustomFont = () => {
    const name = newFont.trim().replace(/['"]/g, '')
    if (!name) return
    const exists = s.customFonts.some(f => f.toLowerCase() === name.toLowerCase()) ||
      APP_FONT_CHOICES.some(c => c.value.toLowerCase() === name.toLowerCase())
    updateSettings({ customFonts: exists ? s.customFonts : [...s.customFonts, name], appFont: name })
    setNewFont('')
    showToast(t('font "{name}" applied', { name }))
  }

  const removeCustomFont = (name: string) => {
    updateSettings({
      customFonts: s.customFonts.filter(f => f !== name),
      ...(s.appFont === name ? { appFont: DEFAULT_APP_FONT } : {})
    })
  }

  return (
    <>
      <Card title={t('Sizes')} icon={<Type size={12} />} description={t('they apply to the whole IDE: panels, editor, SQL')}>
        <Row icon={<Type size={13} />} label={t('font size')} hint={t('text of the IDE and the editors')}>
          <RangeInput min={8} max={30} step={0.5} value={s.fontSize} onChange={(v) => updateSettings({ fontSize: v })}
            title={t('text size')} tip={t('IDE and editor text size')} />
        </Row>
        <Row icon={<Images size={13} />} label={t('icon size')} hint={t('icons of the title bar and the panels')}>
          <RangeInput min={10} max={30} step={1} value={s.iconSize} onChange={(v) => updateSettings({ iconSize: Math.round(v) })}
            title={t('icon size')} tip={t('icon size across the IDE')} />
        </Row>
      </Card>

      <Card title="Font" icon={<Type size={12} />} description={t('the family used by the interface; terminals stay monospace')}>
        <Row icon={<Type size={13} />} label={t('interface font')}>
          <SelectInput value={s.appFont} onChange={(v) => updateSettings({ appFont: v })} options={fontChoices}
            title={t('interface font')} tip={t('family applied to the whole IDE')} style={{ maxWidth: px(240) }} />
        </Row>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: px(10.5), fontFamily: 'var(--font-mono)' }}>
            <Plus size={12} /> {t('add font')}
            <span style={{ color: 'var(--text-muted)', fontSize: px(9.5) }}>— {t('Google Fonts or an installed font')}</span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input value={newFont} onChange={(e) => setNewFont(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCustomFont() }}
              placeholder={t('font family')}
              title={t('family name (Google Fonts or installed font)')} data-tip-desc={t('type a font family name, e.g. Nunito or Fira Sans')}
              style={{ ...inputStyle, flex: 1 }}
            />
            <Btn variant="primary" onClick={addCustomFont} disabled={!newFont.trim()}
              title={t('add and apply the font')} data-tip-desc={t('add the typed font family and apply it')}>
              {t('add')}
            </Btn>
          </div>
          {s.customFonts.length > 0 && (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              {s.customFonts.map(f => (
                <span key={f} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 4px 2px 8px',
                  background: f === s.appFont ? 'var(--accent-bg)' : 'var(--bg-subtle)',
                  border: `1px solid ${f === s.appFont ? 'var(--accent-color)' : 'var(--border-color)'}`,
                  borderRadius: '999px', color: 'var(--text-primary)', fontSize: px(9.5), fontFamily: 'var(--font-mono)'
                }}>
                  {f}
                  <button onClick={() => removeCustomFont(f)} title={`${t('remove')} ${f}`} data-tip-desc={t('remove this custom font')}
                    style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '1px' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </>
  )
}

// ─── Colori: syntax colors of the active theme ───

const COLOR_ENTRIES: { key: keyof ThemeColorConfig; label: string }[] = [
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

export function ColorsPage() {
  const s = useSettingsStore(st => st.settings)
  const updateSettings = useSettingsStore(st => st.updateSettings)
  const t = useI18n()
  const palette = s.theme === 'dark' ? 'dark' : 'light'
  const colors = s.themeColors[palette]

  const setColor = (key: keyof ThemeColorConfig, value: string) => {
    updateSettings({ themeColors: { ...s.themeColors, [palette]: { ...s.themeColors[palette], [key]: value } } })
  }

  const resetColors = () => {
    const defaults = palette === 'dark' ? DEFAULT_DARK_COLORS : DEFAULT_LIGHT_COLORS
    updateSettings({ themeColors: { ...s.themeColors, [palette]: { ...defaults } } })
  }

  return (
    <Card
      title={`${t('editor colors')} — ${s.theme === 'dark' ? t('dark') : t('light')}`}
      icon={<Palette size={12} />}
      description={t('switch theme in Appearance › Theme to edit the other palette')}
      actions={
        <Btn onClick={resetColors} title={t('reset the syntax colors')} data-tip-desc={t('restore the default syntax colors of this theme')}>
          <RotateCcw size={11} /> {t('reset colors')}
        </Btn>
      }
    >
      {COLOR_ENTRIES.map(entry => (
        <Row key={entry.key}
          icon={<span style={{ width: '10px', height: '10px', borderRadius: '3px', background: colors[entry.key], border: '1px solid var(--border-color)', display: 'block' }} />}
          label={<span style={{ color: colors[entry.key] }}>{t(entry.label)}</span>}>
          <ColorInput value={colors[entry.key]} onChange={(v) => setColor(entry.key, v)} title={t(entry.label)} tip={t('color of this token kind in the code editors')} />
        </Row>
      ))}
    </Card>
  )
}
