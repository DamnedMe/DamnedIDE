import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode, Folder, FolderOpen, RefreshCw, X } from '@/components/icons'
import { useToastStore } from '../../store'
import { tr, useI18n } from '../../i18n'

const ROOT_KEY = 'damnedide_sql_files_root'
const SINGLES_KEY = 'damnedide_sql_files_single'
// folders that never hold hand-written scripts and are slow to walk
const SKIPPED_DIRS = new Set(['node_modules', 'bin', 'obj'])

interface Entry { name: string; path: string; isDirectory: boolean }

const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}
const writeStored = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch { /* storage unavailable: the choice lasts for this session */ }
}

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path
const joinPath = (dir: string, name: string) => {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}
export const samePath = (a?: string, b?: string) =>
  !!a && !!b && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** Only sub-folders and .sql files, folders first. */
async function listSqlEntries(dir: string): Promise<Entry[]> {
  const entries = await window.electronAPI.fs.readDir(dir)
  return entries
    .filter(entry => entry.isDirectory ? !SKIPPED_DIRS.has(entry.name.toLowerCase()) : entry.isFile && /\.sql$/i.test(entry.name))
    .map(entry => ({ name: entry.name, path: joinPath(dir, entry.name), isDirectory: entry.isDirectory }))
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

interface SqlFilesPanelProps {
  activeFilePath?: string
  onOpenFile: (filePath: string) => void
}

export function SqlFilesPanel({ activeFilePath, onOpenFile }: SqlFilesPanelProps) {
  const t = useI18n()
  const showToast = useToastStore(s => s.showToast)
  const [root, setRoot] = useState<string | null>(() => readStored<string | null>(ROOT_KEY, null))
  const [singles, setSingles] = useState<string[]>(() => readStored<string[]>(SINGLES_KEY, []))
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [children, setChildren] = useState<Record<string, Entry[] | 'loading' | 'error'>>({})

  const load = useCallback(async (dir: string) => {
    setChildren(current => ({ ...current, [dir]: 'loading' }))
    try {
      const entries = await listSqlEntries(dir)
      setChildren(current => ({ ...current, [dir]: entries }))
    } catch {
      setChildren(current => ({ ...current, [dir]: 'error' }))
    }
  }, [])

  useEffect(() => {
    if (root) void load(root)
  }, [root, load])

  const openFolder = async () => {
    const picked = await window.electronAPI.dialog.openFolder()
    if (!picked) return
    setExpanded({})
    setChildren({})
    setRoot(picked)
    writeStored(ROOT_KEY, picked)
  }

  const closeFolder = () => {
    setRoot(null)
    setExpanded({})
    setChildren({})
    writeStored(ROOT_KEY, null)
  }

  const openSingleFile = async () => {
    const picked = await window.electronAPI.dialog.openFile(tr('Open SQL file'), [{ name: 'SQL', extensions: ['sql'] }])
    if (!picked) return
    if (!/\.sql$/i.test(picked)) {
      showToast(tr('only .sql files can be opened here'), 'info')
      return
    }
    if (!singles.some(item => samePath(item, picked))) {
      const next = [...singles, picked]
      setSingles(next)
      writeStored(SINGLES_KEY, next)
    }
    onOpenFile(picked)
  }

  const removeSingle = (path: string) => {
    const next = singles.filter(item => item !== path)
    setSingles(next)
    writeStored(SINGLES_KEY, next)
  }

  const refresh = () => {
    if (!root) return
    // reload the root and every open folder
    void load(root)
    Object.entries(expanded).forEach(([dir, open]) => { if (open) void load(dir) })
  }

  const toggleDir = (dir: string) => {
    const open = !expanded[dir]
    setExpanded(current => ({ ...current, [dir]: open }))
    if (open && !Array.isArray(children[dir])) void load(dir)
  }

  const sectionTitle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px',
    padding: '8px 10px 4px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700,
    letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)'
  }
  const toolButton: React.CSSProperties = {
    flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px', height: '28px', padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden',
    border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)',
    color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
  }
  const smallIcon: React.CSSProperties = {
    display: 'grid', placeItems: 'center', width: '20px', height: '20px', padding: 0, border: 0,
    borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer'
  }

  const fileRow = (path: string, name: string, depth: number, extra?: React.ReactNode) => {
    const active = samePath(path, activeFilePath)
    return (
      <div key={path} className="sql-files__row" data-active={active} style={{
        display: 'flex', alignItems: 'center',
        background: active ? 'var(--bg-active)' : 'transparent',
        borderLeft: `2px solid ${active ? 'var(--accent-color)' : 'transparent'}`
      }}>
        <button type="button" onClick={() => onOpenFile(path)} title={path} aria-label={t('open file {name}', { name })}
          data-tip-desc={t('open this file in a query tab')}
          style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px', height: '26px',
            padding: `0 6px 0 ${8 + depth * 14 + 14}px`, border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left',
            color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: active ? 600 : 400,
            fontSize: 'calc(10.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
          }}>
          <FileCode size={11} style={{ flexShrink: 0, color: 'var(--accent-color)' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        </button>
        {extra}
      </div>
    )
  }

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const items = children[dir]
    if (items === 'loading' || items === undefined) {
      return <div style={{ padding: `4px 0 4px ${8 + depth * 14 + 14}px`, color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>{t('loading…')}</div>
    }
    if (items === 'error') {
      return <div style={{ padding: `4px 0 4px ${8 + depth * 14 + 14}px`, color: 'var(--error-color)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>{t('folder not readable')}</div>
    }
    if (items.length === 0 && depth === 0) {
      return <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>{t('no .sql files in this folder')}</div>
    }
    return items.map(item => item.isDirectory ? (
      <div key={item.path}>
        <button type="button" onClick={() => toggleDir(item.path)} aria-expanded={!!expanded[item.path]}
          aria-label={t('folder {name}', { name: item.name })} title={item.path}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '5px', height: '26px',
            padding: `0 6px 0 ${8 + depth * 14}px`, border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left',
            color: 'var(--text-secondary)', fontSize: 'calc(10.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
          }}>
          {expanded[item.path] ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {expanded[item.path] ? <FolderOpen size={11} /> : <Folder size={11} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
        </button>
        {expanded[item.path] && renderDir(item.path, depth + 1)}
      </div>
    ) : fileRow(item.path, item.name, depth))
  }

  return (
    <div className="sql-files" aria-label={t('SQL files')} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: '6px', padding: '8px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <button type="button" className="sql-icon-button" style={toolButton} onClick={() => { void openFolder() }}
          title={t('open a folder and show its .sql files')} data-tip-desc={t('open a folder and show its .sql files')}>
          <FolderOpen size={11} /> {t('Open folder')}
        </button>
        <button type="button" className="sql-icon-button" style={toolButton} onClick={() => { void openSingleFile() }}
          title={t('open a single .sql file')} data-tip-desc={t('open a single .sql file')}>
          <FileCode size={11} /> {t('Open file')}
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: '8px' }}>
        {root && (
          <>
            <div style={sectionTitle}>
              <span>{t('Folder')}</span>
              <span style={{ display: 'flex', gap: '2px' }}>
                <button type="button" style={smallIcon} onClick={refresh} aria-label={t('refresh folder')} title={t('refresh folder')} data-tip-desc={t('read the folder again')}><RefreshCw size={10} /></button>
                <button type="button" style={smallIcon} onClick={closeFolder} aria-label={t('close folder')} title={t('close folder')} data-tip-desc={t('stop showing this folder')}><X size={10} /></button>
              </span>
            </div>
            <div title={root} style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 10px 5px',
              color: 'var(--text-primary)', fontWeight: 700, fontSize: 'calc(10.5px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
            }}>
              <FolderOpen size={12} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{baseName(root)}</span>
            </div>
            {renderDir(root, 0)}
          </>
        )}
        {singles.length > 0 && (
          <>
            <div style={{ ...sectionTitle, paddingTop: root ? '14px' : '8px' }}><span>{t('Single files')}</span></div>
            {singles.map(path => fileRow(path, baseName(path), -1,
              <button type="button" style={{ ...smallIcon, marginRight: '6px' }} onClick={() => removeSingle(path)}
                aria-label={t('remove {name} from the list', { name: baseName(path) })} title={t('remove from the list')}>
                <X size={10} />
              </button>))}
          </>
        )}
        {!root && singles.length === 0 && (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
            <Folder size={20} strokeWidth={1} style={{ display: 'block', margin: '0 auto 8px' }} />
            {t('no folder open')}
            <br />
            {t('or drag a .sql file onto the query area')}
          </div>
        )}
      </div>
    </div>
  )
}
