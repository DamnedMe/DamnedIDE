import { useState, useEffect, useCallback } from 'react'
import { Loader2, X, CheckCheckCircle, AlertTriangle, Trash2, Lock } from '@/components/icons'
import { Modal } from '../layout/Modal'
import { useToastStore, useSettingsStore } from '../../store'
import { useAdoFolder } from '../../hooks/useAdoFolder'
import { AdoRepoChooser } from '../ado/AdoRepoChooser'
import { useI18n, tr } from '../../i18n'
import type { AdoWorkItem } from '../../types/ado'
import { classifyCleanup, pbiIdFromBranch, isPbiClosed, folderKind, mainWorktreePath, withChildren, DEFAULT_WORKTREE_LAYOUT, type CleanupResult } from './worktree-cleanup'
import { samePath } from '../../utils/paths'

interface WorktreeCleanupDialogProps {
  repoPath: string
  onClose: () => void
  /** worktrees were removed: reload the list */
  onDone: () => void
}

interface Row extends CleanupResult {
  path: string
  branch: string
  pbiId: number | null
  item?: AdoWorkItem
  /** branches stacked on this one: re-targeted on develop when it goes */
  children: string[]
}

interface Failure {
  path: string
  branch: string
  children: string[]
  error: string
  /** checks passed but the folder is locked: a forced removal is possible */
  canForce: boolean
}

// English labels, translated at render
const VERDICT_META: Record<Row['verdict'], { label: string; color: string; order: number }> = {
  remove: { label: 'useless', color: 'var(--error-color)', order: 0 },
  maybe: { label: 'maybe', color: 'var(--warning-color)', order: 1 },
  keep: { label: 'in use', color: 'var(--text-muted)', order: 2 }
}

const btn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', height: '26px',
  background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)', cursor: 'pointer',
  fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
}

const banner = (color: string, bg: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '8px 10px',
  background: bg, border: `1px solid ${color}`, borderRadius: 'var(--radius-sm)', color,
  fontSize: 'calc(10px * var(--ui-text-scale, 1))', lineHeight: 1.6
})

/**
 * Lists the open worktrees that look useless (PBI closed in Azure DevOps,
 * branch absorbed, or merged with its remote gone) and removes the selected
 * ones through removeSafe, which re-checks right before deleting.
 */
export function WorktreeCleanupDialog({ repoPath, onClose, onDone }: WorktreeCleanupDialogProps) {
  const t = useI18n()
  const showToast = useToastStore(s => s.showToast)
  // Settings › Git › worktree: the PBI id can come from the folder name
  const layout = useSettingsStore(s => s.settings.worktreeLayout) ?? DEFAULT_WORKTREE_LAYOUT
  // connection of the main folder (Settings › Azure DevOps): the PBI states come from its project
  const ado = useAdoFolder(repoPath)
  const connection = ado.status === 'ready' ? ado.connection : null
  const adoReady = !!connection
  // the classification waits until it is known whether ADO can be asked
  const adoSettled = ado.status !== 'loading'
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adoError, setAdoError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [failures, setFailures] = useState<Failure[]>([])
  const [forcing, setForcing] = useState<string | null>(null)
  const busy = running || forcing !== null
  // stable while idle, so Modal does not re-run its focus effect on every toggle
  const close = useCallback(() => { if (!busy) onClose() }, [busy, onClose])

  const connectionId = connection?.id ?? null
  const project = connection?.project ?? ''
  useEffect(() => {
    if (!adoSettled) return
    let cancelled = false
    setAdoError(null)
    ;(async () => {
      try {
        const [overview, stack, list] = await Promise.all([
          window.electronAPI.worktree.overview(repoPath, { localOnly: true }),
          window.electronAPI.worktree.stack(repoPath).catch(() => [] as WorktreeStackInfo[]),
          window.electronAPI.worktree.list(repoPath)
        ])
        // the main checkout never goes: git lists it first, wherever the worktrees live
        const main = mainWorktreePath(list)
        const candidates = overview.filter(o => !main || !samePath(o.path, main))
        // a relative worktree root hangs off the main checkout, also when the opened folder is a linked worktree
        const pbiIdOf = (o: { path: string; branch: string }) => folderKind(o.path, main ?? repoPath, layout)?.id ?? pbiIdFromBranch(o.branch)
        const ids = candidates.map(pbiIdOf).filter((id): id is number => id !== null)
        let items: Map<number, AdoWorkItem> | null = null
        if (connectionId && project && ids.length > 0) {
          try {
            // the main-process ADO service serves one connection at a time
            if (!(await window.electronAPI.ado.use(connectionId))) throw new Error(tr('PAT missing or unreadable: enter it in Settings › Azure DevOps › Connections'))
            const list = await window.electronAPI.ado.workItemsBatch(project, ids)
            items = new Map(list.map(i => [i.id, i]))
          } catch (e) {
            if (!cancelled) setAdoError((e as Error).message || tr('Azure DevOps unreachable'))
          }
        }
        const next: Row[] = candidates.map(o => {
          const pbiId = pbiIdOf(o)
          const item = pbiId !== null ? items?.get(pbiId) : undefined
          // undefined = not verifiable (no ADO, no id), null = id not found in ADO
          const pbiState = items && pbiId !== null ? (item ? item.state : null) : undefined
          return {
            path: o.path,
            branch: o.branch,
            pbiId,
            item,
            children: stack.filter(i => i.parent === o.branch).map(i => i.branch),
            ...classifyCleanup({
              isMain: false,
              branch: o.branch,
              dirty: o.dirty,
              localOnly: o.localOnly,
              pbiState,
              stackState: stack.find(i => i.branch === o.branch)?.state,
              upstream: o.upstream,
              upstreamGone: o.upstreamGone,
              unmerged: o.unmerged
            }, tr)
          }
        })
        const rank = (r: Row) => (r.locked ? 3 : VERDICT_META[r.verdict].order)
        next.sort((a, b) => rank(a) - rank(b) || a.branch.localeCompare(b.branch))
        if (cancelled) return
        setRows(next)
        setSelected(new Set(next.filter(r => r.verdict === 'remove' && !r.locked).map(r => r.path)))
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message || tr('reading the worktrees failed'))
      }
    })()
    return () => { cancelled = true }
  }, [repoPath, adoSettled, connectionId, project])

  const toggle = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** Children of a removed worktree go back to develop, as in the single removal. */
  const retarget = async (branch: string, children: string[]): Promise<number> =>
    children.length > 0
      ? (await window.electronAPI.worktree.retargetChildren(repoPath, branch).catch(() => [] as string[])).length
      : 0

  const removeSelected = async () => {
    if (!rows || busy) return
    const targets = rows.filter(r => selected.has(r.path) && !r.locked)
    if (targets.length === 0) return
    setRunning(true)
    const failed: Failure[] = []
    const removed = new Set<string>()
    let retargeted = 0
    for (const r of targets) {
      try {
        // removeSafe re-checks clean + no local-only commits right before deleting
        const res = await window.electronAPI.worktree.removeSafe(repoPath, r.path)
        if (res.ok) {
          removed.add(r.path)
          // after the removal, so a refused one keeps its children linked
          retargeted += await retarget(r.branch, r.children)
          if (res.warning) showToast(res.warning, res.trashedPath ? 'info' : 'error')
        } else {
          failed.push({ path: r.path, branch: r.branch, children: r.children, error: res.error || tr('removal failed'), canForce: !res.skipped })
        }
      } catch (e) {
        failed.push({ path: r.path, branch: r.branch, children: r.children, error: (e as Error).message || tr('removal failed'), canForce: false })
      }
    }
    setRunning(false)
    if (removed.size > 0) {
      const deleted = removed.size === 1 ? tr('1 worktree deleted') : tr('{n} worktrees deleted', { n: removed.size })
      showToast(withChildren(deleted, retargeted, tr))
      onDone()
    }
    if (failed.length === 0) {
      onClose()
      return
    }
    showToast(failed.length === 1 ? tr('1 worktree not deleted') : tr('{n} worktrees not deleted', { n: failed.length }), 'error')
    setFailures(failed)
    setRows(prev => (prev || []).filter(r => !removed.has(r.path)))
    setSelected(new Set())
  }

  const forceRemove = async (f: Failure) => {
    if (busy) return
    setForcing(f.path)
    try {
      // the forced retry re-runs the safety checks: the folder may have changed since
      const res = await window.electronAPI.worktree.removeSafe(repoPath, f.path, true)
      if (!res.ok) {
        showToast(res.error || tr('removal failed'), 'error')
        if (res.skipped) setFailures(prev => prev.map(x => x.path === f.path ? { ...x, error: res.error || x.error, canForce: false } : x))
        return
      }
      const retargeted = await retarget(f.branch, f.children)
      if (res.warning) showToast(res.warning, res.trashedPath ? 'info' : 'error')
      else showToast(withChildren(tr('worktree deleted'), retargeted, tr))
      setFailures(prev => prev.filter(x => x.path !== f.path))
      setRows(prev => (prev || []).filter(r => r.path !== f.path))
      onDone()
    } catch (e) {
      showToast((e as Error).message || tr('removal failed'), 'error')
    } finally {
      setForcing(null)
    }
  }

  const count = rows ? rows.filter(r => selected.has(r.path) && !r.locked).length : 0
  const small = 'calc(9px * var(--ui-text-scale, 1))'

  return (
    <Modal onClose={close} width={620} label={t('worktree cleanup')}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', flexShrink: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
          <CheckCheckCircle size={15} style={{ color: 'var(--accent-color)' }} />
          {t('worktree cleanup')}
        </span>
        <button onClick={close} disabled={busy} title={t('close')} data-tip-desc={t('close this panel or dialog')}
          style={{ ...btn, width: '24px', height: '24px', padding: 0, justifyContent: 'center' }}>
          <X size={12} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* no connection, or the folder's repository is not clear: choosing it re-reads the PBI states;
            hidden while removing (its «configura in Impostazioni» leaves the panel and drops the progress) */}
        {!adoReady && adoSettled && !busy && <AdoRepoChooser state={ado} compact />}
        {!adoReady && adoSettled && (
          <div style={banner('var(--warning-color)', 'var(--warning-bg)')}>
            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              {t('Without Azure DevOps the PBI state cannot be verified. Worktrees already in develop without a remote branch are proposed as «maybe», not selected.')}
            </span>
          </div>
        )}
        {adoError && (
          <div style={banner('var(--warning-color)', 'var(--warning-bg)')}>
            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{t('Azure DevOps did not answer ({error}): the PBI state is not verified.', { error: adoError })}</span>
          </div>
        )}
        <div style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {t('Before deleting, every worktree is checked again: no uncommitted changes and no unpushed commits. Files ignored by git (bin/obj, local configurations) are deleted too; local branches stay.')}
        </div>

        {loadError ? (
          <div style={{ color: 'var(--error-color)', fontSize: 'calc(11px * var(--ui-text-scale, 1))', wordBreak: 'break-word' }}>{loadError}</div>
        ) : !rows ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(11px * var(--ui-text-scale, 1))' }}>
            {t('no open worktree besides the main checkout')}
          </div>
        ) : rows.map(r => {
          const meta = VERDICT_META[r.verdict]
          const closedState = isPbiClosed(r.item?.state)
          return (
            <label key={r.path} title={r.path}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 8px', flexShrink: 0,
                background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                cursor: r.locked || busy ? 'not-allowed' : 'pointer', opacity: r.locked ? 0.6 : 1
              }}>
              <input type="checkbox" checked={selected.has(r.path)} disabled={r.locked || busy}
                onChange={() => toggle(r.path)} style={{ marginTop: '2px' }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'calc(11px * var(--ui-text-scale, 1))' }}>
                  {r.pbiId !== null && <span style={{ color: 'var(--accent-color)', fontWeight: 700, flexShrink: 0 }}>#{r.pbiId}</span>}
                  {r.item?.state && (
                    <span style={{
                      padding: '0 5px', borderRadius: 'var(--radius-sm)', fontSize: small, fontWeight: 700, flexShrink: 0,
                      border: `1px solid ${closedState ? 'var(--success-color)' : 'var(--border-color)'}`,
                      color: closedState ? 'var(--success-color)' : 'var(--text-secondary)'
                    }}>
                      {r.item.state}
                    </span>
                  )}
                  <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.item?.title || r.branch}
                  </span>
                </div>
                <div style={{ fontSize: small, color: 'var(--text-muted)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {[r.branch, ...r.reasons, ...(r.children.length > 0 ? [t('children moved back to develop: {branches}', { branches: r.children.join(', ') })] : [])].join(' · ')}
                </div>
              </div>
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: small, fontWeight: 700, flexShrink: 0, color: r.locked ? 'var(--text-muted)' : meta.color }}>
                {r.locked ? <><Lock size={10} /> {t('protected')}</> : t(meta.label)}
              </span>
            </label>
          )
        })}

        {failures.length > 0 && (
          <div style={{ ...banner('var(--error-color)', 'var(--error-bg)'), flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontWeight: 700 }}>{t('not deleted')}</span>
            {failures.map(f => (
              <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                  <b>{f.branch}</b> — {f.error}
                </span>
                {f.canForce && (
                  <button onClick={() => forceRemove(f)} disabled={busy}
                    title={t('force the removal')} data-tip-desc={t('close the terminals in the folder, unregister the worktree and delete it even if a program keeps it open')}
                    style={{ ...btn, height: '22px', padding: '2px 8px', color: 'var(--error-color)', borderColor: 'var(--error-color)' }}>
                    {forcing === f.path ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={10} />}
                    {t('force')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px', flexShrink: 0 }}>
        <button onClick={close} disabled={busy} style={btn}>{t('cancel')}</button>
        <button onClick={removeSelected} disabled={count === 0 || busy}
          style={{
            ...btn, border: 'none',
            background: count > 0 && !busy ? 'var(--error-color)' : 'var(--bg-disabled)',
            color: count > 0 && !busy ? 'var(--text-inverse)' : 'var(--text-muted)',
            cursor: count > 0 && !busy ? 'pointer' : 'not-allowed'
          }}>
          {running ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={11} />}
          {count === 1 ? t('delete 1 worktree') : t('delete {n} worktrees', { n: count })}
        </button>
      </div>
    </Modal>
  )
}
