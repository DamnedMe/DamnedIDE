import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GitFileStatus } from '../../types/git'
import { FileDiffList } from '../git/FileDiffList'
import { DiffViewer } from '../editor/DiffViewer'
import { Loader2, AlertCircle, RefreshCw, X, GitCompare } from '@/components/icons'
import { joinPath } from '../../utils/paths'
import { useI18n } from '../../i18n'

type BaseDiff = Awaited<ReturnType<Window['electronAPI']['worktree']['baseDiff']>>

export interface WorktreeBaseDiffOptions {
  worktreePath: string
  /** branch the worktree started from: develop, or the parent of a stacked branch */
  base: string
  checkMarks: Record<string, 'ok' | 'ko'>
  onToggleCheck: (filePath: string, state: 'ok' | 'ko' | null) => void
  /** back to the pending changes */
  onClose: () => void
}

const toRow = (f: BaseDiff['files'][number]): GitFileStatus => ({
  path: f.path, index: f.status, workingDir: ' ', staged: false, unstaged: true,
  isNew: f.status === 'A', isDeleted: f.status === 'D', isModified: f.status === 'M' || f.status === 'R', isRenamed: f.status === 'R'
})

const muted = { color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' } as const
const iconBtn = { display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' } as const

/**
 * Read-only "Changes" view of a worktree against its base, as the PR shows it:
 * every commit of the branch (pushed or not) plus the pending changes, one row per file.
 * A hook, not a wrapper: the caller swaps the parts into its own layout, so the layout
 * (terminal dock included) is not remounted. null = off.
 */
export function useWorktreeBaseDiff(opts: WorktreeBaseDiffOptions | null): { list: ReactNode; diff: ReactNode; count: number } | null {
  const worktreePath = opts?.worktreePath ?? ''
  const base = opts?.base ?? ''
  const t = useI18n()
  const [data, setData] = useState<BaseDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [sides, setSides] = useState<{ original: string; modified: string; error: string | null } | null>(null)
  const selectedRef = useRef<string | null>(null)
  const requestRef = useRef(0) // a late answer for another worktree or base is dropped

  const open = useCallback(async (diff: BaseDiff, path: string) => {
    selectedRef.current = path
    setSelected(path)
    const f = diff.files.find(x => x.path === path)
    if (!f) return
    let readError: string | null = null
    const [original, modified] = await Promise.all([
      f.status === 'A' ? '' : window.electronAPI.git.showRef(worktreePath, f.oldPath ?? f.path, diff.mergeBase),
      f.status === 'D' ? '' : window.electronAPI.fs.readFile(joinPath(worktreePath, f.path)).catch((e: Error) => { readError = e.message; return '' })
    ])
    if (selectedRef.current === path) setSides({ original, modified, error: readError })
  }, [worktreePath])

  const load = useCallback(async () => {
    const request = ++requestRef.current
    if (!worktreePath) { setData(null); setError(null); setLoading(false); selectedRef.current = null; setSelected(null); setSides(null); return }
    setLoading(true)
    setError(null)
    try {
      const diff = await window.electronAPI.worktree.baseDiff(worktreePath, base)
      if (request !== requestRef.current) return
      setData(diff)
      const keep = selectedRef.current && diff.files.some(f => f.path === selectedRef.current) ? selectedRef.current : null
      if (keep) void open(diff, keep)
      else { selectedRef.current = null; setSelected(null); setSides(null) }
    } catch (e) {
      if (request === requestRef.current) setError(((e as Error).message || String(e)).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''))
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [worktreePath, base, open])

  // ponytail: refreshed on open and by the button, not by the file watcher
  useEffect(() => { void load() }, [load])

  if (!opts) return null
  const { checkMarks, onToggleCheck, onClose } = opts
  const list = (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', overflow: 'hidden' }}>
      <div style={{ padding: '5px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <GitCompare size={11} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
        <span title={data?.mergeBase} style={{ ...muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t('vs {base}', { base: data?.base ?? base })}{data ? ` · ${data.files.length}` : ''}
        </span>
        <button onClick={() => void load()} title={t('refresh')} data-tip-desc={t('reload the comparison with the base')} style={iconBtn}>
          {loading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={11} />}
        </button>
        <button onClick={onClose} title={t('back to pending changes')} data-tip-desc={t('leave the comparison with the base')} style={iconBtn}>
          <X size={11} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {error ? (
          <div style={{ ...muted, display: 'flex', gap: '6px', padding: '16px', color: 'var(--error-color)', wordBreak: 'break-word' }}>
            <AlertCircle size={12} style={{ flexShrink: 0 }} /> {error}
          </div>
        ) : data && (
          <FileDiffList files={data.files.map(toRow)} activeDiffFile={selected} onViewDiff={(path) => void open(data, path)}
            checkMarks={checkMarks} onToggleCheck={onToggleCheck} />
        )}
      </div>
    </div>
  )

  const diff = selected && sides ? (
    sides.error ? (
      <div style={{ ...muted, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', height: '100%', padding: '16px' }}>
        <AlertCircle size={12} /> {sides.error}
      </div>
    ) : (
      <DiffViewer key={selected} original={sides.original} modified={sides.modified} filePath={selected}
        onClose={() => { selectedRef.current = null; setSelected(null); setSides(null) }} />
    )
  ) : (
    <div style={{ ...muted, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '16px', textAlign: 'center' }}>
      {t('every change of the branch since it left {base}, commits and pending ones together: pick a file', { base: data?.base ?? base })}
    </div>
  )

  return { list, diff, count: data?.files.length ?? 0 }
}
