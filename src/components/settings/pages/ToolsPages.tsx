import { AlignLeft, ChevronLeft, ChevronRight, Download, Eraser, FolderSearch, FolderTree, GitBranch, GitCompare, Indent, Keyboard, LayoutGrid, MousePointer2, Palette, RotateCcw, Save, TerminalSquare, TextQuote, WrapText } from '@/components/icons'
import { useSettingsStore, useToastStore } from '../../../store'
import type { SettingsPageId } from '../../../store'
import { useI18n } from '../../../i18n'
import { TERMINAL_FONT_DEFAULT, TERMINAL_FONT_MAX, TERMINAL_FONT_MIN } from '../../terminal/terminal-zoom'
import { TERMINAL_FONT_STACK } from '../../../utils/fonts'
import { Btn, Card, CardBody, Chip, Notice, PathText, RangeInput, Row, SelectInput, Toggle, px } from '../ui'

// ─── Editor ───

export function EditorPage({ onOpenPage }: { onOpenPage: (page: SettingsPageId) => void }) {
  const s = useSettingsStore(st => st.settings)
  const updateSettings = useSettingsStore(st => st.updateSettings)
  const t = useI18n()
  return (
    <>
      <Card title="Visualizzazione" icon={<LayoutGrid size={12} />}>
        <Row icon={<LayoutGrid size={13} />} label={t('minimap')} hint="anteprima del file a destra dell'editor">
          <Toggle checked={s.minimap} onChange={(v) => updateSettings({ minimap: v })} title={t('minimap')} />
        </Row>
        <Row icon={<AlignLeft size={13} />} label={t('line numbers')}>
          <SelectInput value={s.lineNumbers} onChange={(v) => updateSettings({ lineNumbers: v as 'on' | 'off' | 'relative' })} options={[
            { value: 'on', label: t('on') },
            { value: 'off', label: t('off') },
            { value: 'relative', label: t('relative') }
          ]} />
        </Row>
        <Row icon={<WrapText size={13} />} label={t('word wrap')} hint="le righe lunghe vanno a capo invece di scorrere">
          <Toggle checked={s.wordWrap === 'on'} onChange={(v) => updateSettings({ wordWrap: v ? 'on' : 'off' })} title={t('word wrap')} />
        </Row>
        <Row icon={<TextQuote size={13} />} label={t('font ligatures')} hint="=> != === mostrati come un solo simbolo">
          <Toggle checked={s.fontLigatures} onChange={(v) => updateSettings({ fontLigatures: v })} title={t('font ligatures')} />
        </Row>
        <Row icon={<Palette size={13} />} label={t('editor colors')} hint="dimensione del testo in Aspetto › Testo e icone">
          <Btn onClick={() => onOpenPage('colors')} title="apri i colori della sintassi" data-tip-desc="Aspetto › Colori">
            colori <ChevronRight size={11} />
          </Btn>
        </Row>
      </Card>

      <Card title="Scrittura" icon={<Indent size={12} />}>
        <Row icon={<Indent size={13} />} label={t('tab size')}>
          <SelectInput value={String(s.tabSize)} onChange={(v) => updateSettings({ tabSize: parseInt(v) })} options={[
            { value: '2', label: t('2 spaces') },
            { value: '4', label: t('4 spaces') },
            { value: '8', label: t('8 spaces') }
          ]} />
        </Row>
        <Row icon={<Save size={13} />} label={t('auto save')} hint="salva il file a ogni modifica">
          <Toggle checked={s.autoSave} onChange={(v) => updateSettings({ autoSave: v })} title={t('auto save')} />
        </Row>
        <Row icon={<ChevronLeft size={13} />} label={t('navigation keybindings')} hint="torna indietro / avanti tra le posizioni visitate">
          <SelectInput value={s.navKeybindings} onChange={(v) => updateSettings({ navKeybindings: v as 'vs-studio' | 'vs-code' })} options={[
            { value: 'vs-studio', label: t('VS Studio — Ctrl+- / Ctrl+Shift+-') },
            { value: 'vs-code', label: t('VS Code — Alt+Left / Alt+Right') }
          ]} />
        </Row>
      </Card>
    </>
  )
}

// ─── Terminale ───

const kbd = (k: string) => (
  <kbd style={{
    display: 'inline-block', padding: '0 5px', margin: '0 1px', borderRadius: '3px',
    border: '1px solid var(--border-color)', background: 'var(--bg-subtle)', color: 'var(--text-secondary)',
    fontSize: px(9), fontFamily: 'var(--font-mono)', lineHeight: 1.6
  }}>{k}</kbd>
)

export function TerminalPage() {
  const size = useSettingsStore(st => st.settings.terminalFontSize)
  const updateSettings = useSettingsStore(st => st.updateSettings)
  const clamp = (v: number) => Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, Math.round(v)))
  return (
    <>
      <Card>
        <Row icon={<TerminalSquare size={13} />} label="dimensione del testo"
          hint={`uguale per tutti i terminali, da ${TERMINAL_FONT_MIN} a ${TERMINAL_FONT_MAX}px`}>
          <RangeInput min={TERMINAL_FONT_MIN} max={TERMINAL_FONT_MAX} step={1} value={size}
            onChange={(v) => updateSettings({ terminalFontSize: clamp(v) })}
            title="dimensione del testo del terminale" tip="xterm font size shared by every terminal" />
          <Btn onClick={() => updateSettings({ terminalFontSize: TERMINAL_FONT_DEFAULT })} disabled={size === TERMINAL_FONT_DEFAULT}
            title={`torna a ${TERMINAL_FONT_DEFAULT}px`} data-tip-desc="restore the default terminal font size">
            <RotateCcw size={11} /> {TERMINAL_FONT_DEFAULT}px
          </Btn>
        </Row>
        <div style={{
          margin: '0 12px 12px', padding: '8px 10px', borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', overflow: 'hidden',
          fontFamily: TERMINAL_FONT_STACK, fontSize: `${size}px`,
          color: 'var(--text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis'
        }}>
          <span style={{ color: 'var(--success-color)' }}>PS C:\repos&gt;</span> git status
        </div>
      </Card>
      <Notice tone="info" icon={<Keyboard size={12} />}>
        anche dal terminale: {kbd('Ctrl')} + rotellina <MousePointer2 size={10} style={{ verticalAlign: '-1px' }} />, {kbd('Ctrl')}{kbd('+')} e {kbd('Ctrl')}{kbd('−')} di un px alla volta, {kbd('Ctrl')}{kbd('0')} torna a {TERMINAL_FONT_DEFAULT}px.
      </Notice>
    </>
  )
}

// ─── Git: GitTree executable ───

// same as GITTREE_DOWNLOAD_URL (electron/services/gitclient/gittree.ts): not importable from the renderer
const GITTREE_DOWNLOAD_URL = 'https://github.com/giannoccarol/gittree/releases/latest'

export function GitPage() {
  const path = useSettingsStore(st => st.settings.gitTreePath)
  const showPath = useSettingsStore(st => st.settings.changesShowPath)
  const updateSettings = useSettingsStore(st => st.updateSettings)
  const showToast = useToastStore(st => st.showToast)
  const t = useI18n()

  const browse = async () => {
    const filters = window.electronAPI.platform === 'win32'
      ? [{ name: 'GitTree', extensions: ['exe'] }]
      // Linux AppImages and plain binaries have no extension
      : [{ name: 'All files', extensions: ['*'] }]
    try {
      const picked = await window.electronAPI.dialog.openFile(t('select the GitTree executable'), filters)
      if (!picked) return
      updateSettings({ gitTreePath: picked })
      showToast('eseguibile di GitTree salvato')
    } catch (e) {
      showToast((e as Error).message || 'selezione del file fallita', 'error')
    }
  }

  return (
    <>
      <Card title="GitTree" icon={<GitBranch size={12} />}
        description="la voce Git della barra del titolo apre il repository (o il worktree selezionato) in GitTree">
        <Row icon={<FolderSearch size={13} />} label="eseguibile"
          hint={path ? <PathText>{path}</PathText> : 'rilevamento automatico nei percorsi di installazione abituali'}
          align="flex-start">
          {path ? <Chip tone="success">scelto</Chip> : <Chip>automatico</Chip>}
        </Row>
        <CardBody>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <Btn variant="primary" onClick={() => { void browse() }}
              title={t('locate GitTree…')} data-tip-desc="pick the GitTree executable; it is remembered for the next time">
              <FolderSearch size={11} /> sfoglia…
            </Btn>
            <Btn onClick={() => { updateSettings({ gitTreePath: '' }); showToast('GitTree: torna il rilevamento automatico', 'info') }} disabled={!path}
              title="dimentica il percorso" data-tip-desc="GitTree is detected again in the usual install locations">
              <Eraser size={11} /> rimuovi
            </Btn>
            <Btn variant="subtle" onClick={() => { void window.electronAPI.shell.openExternal(GITTREE_DOWNLOAD_URL).catch(() => {}) }}
              title={t('download GitTree')} data-tip-desc={GITTREE_DOWNLOAD_URL}>
              <Download size={11} /> {t('download GitTree')}
            </Btn>
          </div>
        </CardBody>
      </Card>
      {!path && (
        <Notice tone="neutral">
          se GitTree non è installato nei percorsi abituali, scaricalo oppure indica l'eseguibile con «sfoglia…»: la scelta viene ricordata.
          Quando l'IDE lo trova da solo, il percorso compare qui.
        </Notice>
      )}
      <Card title="Changes" icon={<GitCompare size={12} />}
        description="file modificati di Worktree › Changes e del pannello changes dell'editor, raggruppati per tipologia (controller, service, DB, test…)">
        <Row icon={<FolderTree size={13} />} label="mostra il percorso sotto il nome del file"
          hint="spento: solo il nome; il percorso completo resta nel tooltip della riga">
          <Toggle checked={showPath} onChange={(v) => updateSettings({ changesShowPath: v })}
            title="mostra il percorso sotto il nome del file" tip="show the folder of each changed file on a second line" />
        </Row>
      </Card>
    </>
  )
}
