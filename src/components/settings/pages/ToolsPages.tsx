import { useState } from 'react'
import { AlignLeft, Bug, ChevronLeft, ChevronRight, Download, Eraser, FolderSearch, FolderTree, GitBranch, GitCompare, Indent, Keyboard, LayoutGrid, MousePointer2, Palette, RotateCcw, Save, Sparkles, TerminalSquare, TextQuote, Timer, WrapText } from '@/components/icons'
import { SQL_QUERY_TIMEOUTS, useSettingsStore, useToastStore, useWorktreeStore } from '../../../store'
import type { SettingsPageId } from '../../../store'
import { useI18n, tr } from '../../../i18n'
import { TERMINAL_FONT_DEFAULT, TERMINAL_FONT_MAX, TERMINAL_FONT_MIN } from '../../terminal/terminal-zoom'
import { TERMINAL_FONT_STACK } from '../../../utils/fonts'
import { joinPath, normalizeSlashes, samePath } from '../../../utils/paths'
import { DEFAULT_WORKTREE_LAYOUT, isAbsolutePath, mainWorktreePath, type WorktreeLayout } from '../../worktree/worktree-cleanup'
import { Btn, Card, CardBody, Chip, Notice, PathText, RangeInput, Row, SelectInput, Toggle, inputStyle, px } from '../ui'

// ─── Editor ───

export function EditorPage({ onOpenPage }: { onOpenPage: (page: SettingsPageId) => void }) {
  const s = useSettingsStore(st => st.settings)
  const updateSettings = useSettingsStore(st => st.updateSettings)
  const t = useI18n()
  return (
    <>
      <Card title={t('Display')} icon={<LayoutGrid size={12} />}>
        <Row icon={<LayoutGrid size={13} />} label={t('minimap')} hint={t('preview of the file on the right of the editor')}>
          <Toggle checked={s.minimap} onChange={(v) => updateSettings({ minimap: v })} title={t('minimap')} />
        </Row>
        <Row icon={<AlignLeft size={13} />} label={t('line numbers')}>
          <SelectInput value={s.lineNumbers} onChange={(v) => updateSettings({ lineNumbers: v as 'on' | 'off' | 'relative' })} options={[
            { value: 'on', label: t('on') },
            { value: 'off', label: t('off') },
            { value: 'relative', label: t('relative') }
          ]} />
        </Row>
        <Row icon={<WrapText size={13} />} label={t('word wrap')} hint={t('long lines wrap instead of scrolling')}>
          <Toggle checked={s.wordWrap === 'on'} onChange={(v) => updateSettings({ wordWrap: v ? 'on' : 'off' })} title={t('word wrap')} />
        </Row>
        <Row icon={<TextQuote size={13} />} label={t('font ligatures')} hint={t('=> != === shown as a single symbol')}>
          <Toggle checked={s.fontLigatures} onChange={(v) => updateSettings({ fontLigatures: v })} title={t('font ligatures')} />
        </Row>
        <Row icon={<Palette size={13} />} label={t('editor colors')} hint={t('text size in Appearance › Text and icons')}>
          <Btn onClick={() => onOpenPage('colors')} title={t('open the syntax colors')} data-tip-desc={t('Appearance › Colors')}>
            {t('colors')} <ChevronRight size={11} />
          </Btn>
        </Row>
      </Card>

      <Card title={t('Writing')} icon={<Indent size={12} />}>
        <Row icon={<Indent size={13} />} label={t('tab size')}>
          <SelectInput value={String(s.tabSize)} onChange={(v) => updateSettings({ tabSize: parseInt(v) })} options={[
            { value: '2', label: t('2 spaces') },
            { value: '4', label: t('4 spaces') },
            { value: '8', label: t('8 spaces') }
          ]} />
        </Row>
        <Row icon={<Save size={13} />} label={t('auto save')} hint={t('saves the file on every change')}>
          <Toggle checked={s.autoSave} onChange={(v) => updateSettings({ autoSave: v })} title={t('auto save')} />
        </Row>
        <Row icon={<ChevronLeft size={13} />} label={t('navigation keybindings')} hint={t('go back / forward through the visited positions')}>
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
  const t = useI18n()
  return (
    <>
      <Card>
        <Row icon={<TerminalSquare size={13} />} label={t('text size')}
          hint={t('the same for every terminal, from {min} to {max}px', { min: TERMINAL_FONT_MIN, max: TERMINAL_FONT_MAX })}>
          <RangeInput min={TERMINAL_FONT_MIN} max={TERMINAL_FONT_MAX} step={1} value={size}
            onChange={(v) => updateSettings({ terminalFontSize: clamp(v) })}
            title={t('terminal text size')} tip={t('xterm font size shared by every terminal')} />
          <Btn onClick={() => updateSettings({ terminalFontSize: TERMINAL_FONT_DEFAULT })} disabled={size === TERMINAL_FONT_DEFAULT}
            title={t('back to {n}px', { n: TERMINAL_FONT_DEFAULT })} data-tip-desc={t('restore the default terminal font size')}>
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
        {t('also from the terminal:')} {kbd('Ctrl')} + {t('wheel')} <MousePointer2 size={10} style={{ verticalAlign: '-1px' }} />, {kbd('Ctrl')}{kbd('+')} {t('and')} {kbd('Ctrl')}{kbd('−')} {t('one px at a time')}, {kbd('Ctrl')}{kbd('0')} {t('back to {n}px', { n: TERMINAL_FONT_DEFAULT })}.
      </Notice>
    </>
  )
}

// ─── SQL ───

export function SqlPage() {
  const timeout = useSettingsStore(st => st.settings.sqlQueryTimeout)
  const updateSettings = useSettingsStore(st => st.updateSettings)
  const t = useI18n()
  const label = (s: number) => s < 60 ? t('{n} seconds', { n: s }) : s === 60 ? t('1 minute') : t('{n} minutes', { n: s / 60 })
  return (
    <Card>
      <Row icon={<Timer size={13} />} label={t('query timeout')}
        hint={t('after this time the query stops with an error; a connection whose own execution timeout is longer, or under 30 seconds, keeps it')}>
        <SelectInput value={String(timeout)} onChange={(v) => updateSettings({ sqlQueryTimeout: Number(v) })}
          options={SQL_QUERY_TIMEOUTS.map(s => ({ value: String(s), label: label(s) }))}
          title={t('query timeout')} />
      </Row>
    </Card>
  )
}

// ─── Git: worktree folders ───

const tidy = (s: string) => s.trim().replace(/^[\\/]+|[\\/]+$/g, '')
/** The root as saved: no trailing separator, except a drive root ('D:\', what browse returns:
 *  'D:' alone would read as relative elsewhere) and '/'; empty = the default .worktrees. */
const tidyRoot = (s: string) => {
  const r = s.trim()
  if (!r) return DEFAULT_WORKTREE_LAYOUT.root
  if (/^[a-z]:[\\/]*$/i.test(r)) return `${r.slice(0, 2)}\\`
  return r.replace(/[\\/]+$/, '') || r[0]
}

/** Where the worktrees live: the strip reads PBI/bug from these folders, new worktrees go there. */
function WorktreeLayoutCard({ repoPath }: { repoPath: string | null }) {
  const saved = useSettingsStore(st => st.settings.worktreeLayout)
  const updateSettings = useSettingsStore(st => st.updateSettings)
  const showToast = useToastStore(st => st.showToast)
  const entries = useWorktreeStore(st => st.entries)
  const t = useI18n()
  const [draft, setDraft] = useState<WorktreeLayout>(saved ?? DEFAULT_WORKTREE_LAYOUT)
  const set = (patch: Partial<WorktreeLayout>) => setDraft(d => ({ ...d, ...patch }))
  const next: WorktreeLayout = { root: tidyRoot(draft.root), pbiFolder: tidy(draft.pbiFolder), bugFolder: tidy(draft.bugFolder) }
  const changed = !saved || saved.root !== next.root || saved.pbiFolder !== next.pbiFolder || saved.bugFolder !== next.bugFolder
  // a relative root hangs off the main checkout, also when the opened folder is a linked worktree;
  // the worktree list in the store is used only when it belongs to the opened folder
  const listed = !!repoPath && entries.some(e => samePath(e.path, repoPath))
  const basePath = (listed ? mainWorktreePath(entries) : null) ?? repoPath
  const rootDir = isAbsolutePath(next.root) ? next.root
    : joinPath(basePath ?? `<${t('repository')}>`, next.root.replace(/^\.(?:[\\/]|$)/, ''))
  const sameSub = normalizeSlashes(next.pbiFolder).toLowerCase() === normalizeSlashes(next.bugFolder).toLowerCase()

  const browse = async () => {
    try {
      const picked = await window.electronAPI.dialog.openFolder()
      if (!picked) return
      // inside the main checkout: kept relative, so it holds for every repository with the same layout
      const base = basePath?.replace(/[\\/]+$/, '') ?? ''
      const inside = !!base && normalizeSlashes(picked).toLowerCase().startsWith(`${normalizeSlashes(base).toLowerCase()}/`)
      set({ root: inside ? picked.slice(base.length + 1) : base && samePath(picked, base) ? '.' : picked })
    } catch (e) {
      showToast((e as Error).message || t('folder selection failed'), 'error')
    }
  }

  const field = (value: string, onChange: (v: string) => void, title: string, placeholder: string) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} title={title} placeholder={placeholder} spellCheck={false}
      style={{ ...inputStyle, width: 'clamp(140px, 30vw, 260px)' }} />
  )

  return (
    <Card title="Worktree" icon={<FolderTree size={12} />}
      description={t('where the worktrees live: the strip tells PBIs from bugs by these folders and new worktrees are created there')}
      actions={!saved ? <Chip tone="warning" tip={t('until it is saved the IDE uses .worktrees/feature and .worktrees/bugfix')}>{t('to set')}</Chip> : undefined}>
      <Row icon={<FolderSearch size={13} />} label={t('worktree folder')}
        hint={t('relative to the repository (.worktrees, or . for folders next to the sources) or absolute')}>
        {field(draft.root, (v) => set({ root: v }), t('worktree folder'), '.worktrees')}
        <Btn onClick={() => { void browse() }} title={t('pick the worktree folder')}>
          <FolderSearch size={11} /> {t('browse…')}
        </Btn>
      </Row>
      <Row icon={<Sparkles size={13} />} label={t('PBI subfolder')} hint={t('empty: straight in the worktree folder')}>
        {field(draft.pbiFolder, (v) => set({ pbiFolder: v }), t('PBI subfolder'), 'feature')}
      </Row>
      <Row icon={<Bug size={13} />} label={t('bug subfolder')} hint={t('empty: straight in the worktree folder')}>
        {field(draft.bugFolder, (v) => set({ bugFolder: v }), t('bug subfolder'), 'bugfix')}
      </Row>
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: px(9.5), fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
          <span>PBI → {joinPath(rootDir, next.pbiFolder, '1234')}</span>
          <span>bug → {joinPath(rootDir, next.bugFolder, '1234')}</span>
          {sameSub && (
            <span style={{ color: 'var(--warning-color)' }}>
              {next.pbiFolder
                ? t('PBI and bug share the same subfolder: they are told apart by the branch name only')
                : t('with no subfolders PBI and bug are told apart by the branch name only')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <Btn variant="primary" disabled={!changed}
            onClick={() => { updateSettings({ worktreeLayout: next }); setDraft(next); showToast(t('worktree folders saved')) }}
            title={t('save the worktree folders')}>
            <Save size={11} /> {t('save')}
          </Btn>
          <Btn onClick={() => setDraft(DEFAULT_WORKTREE_LAYOUT)} title={t('back to .worktrees/feature and .worktrees/bugfix')}>
            <RotateCcw size={11} /> {t('defaults')}
          </Btn>
        </div>
      </CardBody>
    </Card>
  )
}

// ─── Git: GitTree executable ───

// same as GITTREE_DOWNLOAD_URL (electron/services/gitclient/gittree.ts): not importable from the renderer
const GITTREE_DOWNLOAD_URL = 'https://github.com/giannoccarol/gittree/releases/latest'

export function GitPage({ repoPath }: { repoPath: string | null }) {
  const path = useSettingsStore(st => st.settings.gitTreePath)
  const showPath = useSettingsStore(st => st.settings.changesShowPath)
  const updateSettings = useSettingsStore(st => st.updateSettings)
  const showToast = useToastStore(st => st.showToast)
  const t = useI18n()

  const browse = async () => {
    const filters = window.electronAPI.platform === 'win32'
      ? [{ name: 'GitTree', extensions: ['exe'] }]
      // Linux AppImages and plain binaries have no extension
      : [{ name: t('All files'), extensions: ['*'] }]
    try {
      const picked = await window.electronAPI.dialog.openFile(t('select the GitTree executable'), filters)
      if (!picked) return
      updateSettings({ gitTreePath: picked })
      showToast(tr('GitTree executable saved'))
    } catch (e) {
      showToast((e as Error).message || tr('file selection failed'), 'error')
    }
  }

  return (
    <>
      <WorktreeLayoutCard repoPath={repoPath} />
      <Card title="GitTree" icon={<GitBranch size={12} />}
        description={t('the Git entry of the title bar opens the repository (or the selected worktree) in GitTree')}>
        <Row icon={<FolderSearch size={13} />} label={t('executable')}
          hint={path ? <PathText>{path}</PathText> : t('automatic detection in the usual install locations')}
          align="flex-start">
          {path ? <Chip tone="success">{t('chosen')}</Chip> : <Chip>{t('automatic')}</Chip>}
        </Row>
        <CardBody>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <Btn variant="primary" onClick={() => { void browse() }}
              title={t('locate GitTree…')} data-tip-desc={t('pick the GitTree executable; it is remembered for the next time')}>
              <FolderSearch size={11} /> {t('browse…')}
            </Btn>
            <Btn onClick={() => { updateSettings({ gitTreePath: '' }); showToast(t('GitTree: automatic detection is back'), 'info') }} disabled={!path}
              title={t('forget the path')} data-tip-desc={t('GitTree is detected again in the usual install locations')}>
              <Eraser size={11} /> {t('remove')}
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
          {t('if GitTree is not installed in the usual locations, download it or point to the executable with «browse…»: the choice is remembered. When the IDE finds it on its own, the path shows here.')}
        </Notice>
      )}
      <Card title={t('Changes')} icon={<GitCompare size={12} />}
        description={t('changed files of Worktree › Changes and of the editor changes panel, grouped by type (controller, service, DB, test…)')}>
        <Row icon={<FolderTree size={13} />} label={t('show the path under the file name')}
          hint={t('off: the name only; the full path stays in the row tooltip')}>
          <Toggle checked={showPath} onChange={(v) => updateSettings({ changesShowPath: v })}
            title={t('show the path under the file name')} tip={t('show the folder of each changed file on a second line')} />
        </Row>
      </Card>
    </>
  )
}
