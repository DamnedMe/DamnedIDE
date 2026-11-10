import { useState, useEffect } from 'react'
import { Loader2, X, GitPullRequest, CheckCircle2, XCircle, AlertTriangle, FileCode, Layers, Trash2 } from '@/components/icons'
import { useEditorStore, useToastStore, useSettingsStore } from '../../store'
import { useAdoFolder } from '../../hooks/useAdoFolder'
import { AdoRepoChooser, useConnectionRepos } from '../ado/AdoRepoChooser'
import { sameName } from '../../shared/adoSettings'
import { joinPath, samePath } from '../../utils/paths'
import { pbiIdFromBranch, folderKind, withChildren, DEFAULT_WORKTREE_LAYOUT } from './worktree-cleanup'
import { useI18n, tr } from '../../i18n'

interface CompleteWorktreeDialogProps {
  worktreePath: string
  /** the worktree's branch: its PBI id goes in the commit / PR title */
  branch: string
  repoPath: string
  /** where a relative worktree root is resolved: the main checkout (default: repoPath) */
  basePath?: string
  onClose: () => void
  onDone: () => void
}

interface StepLog {
  label: string
  status: 'pending' | 'running' | 'ok' | 'error' | 'warn'
  detail?: string
}

export function CompleteWorktreeDialog({ worktreePath, branch, repoPath, basePath = repoPath, onClose, onDone }: CompleteWorktreeDialogProps) {
  const [message, setMessage] = useState('')
  const [steps, setSteps] = useState<StepLog[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [prCreated, setPrCreated] = useState<number | null>(null)
  // what Azure DevOps did with it (auto-complete may not take: see AdoService.createPullRequest)
  const [prMode, setPrMode] = useState<'autocomplete' | 'completed' | 'open' | null>(null)
  const [prFailed, setPrFailed] = useState(false)
  const [completed, setCompleted] = useState(false)
  // '' = not picked: the folder's resolved repository
  const [pickedRepo, setPickedRepo] = useState('')
  const [autoComplete, setAutoComplete] = useState(false)
  const [stackInfo, setStackInfo] = useState<WorktreeStackInfo | null>(null)
  const [removingChild, setRemovingChild] = useState(false)
  // connection + repository of the main folder (Settings › Azure DevOps)
  const ado = useAdoFolder(repoPath)
  const connection = ado.status === 'ready' ? ado.connection : null
  const adoReady = !!connection
  // repositories of the connection, for the repository select (default: the folder's)
  const repoList = useConnectionRepos(connection?.id ?? null)
  const listed = repoList?.ok ? repoList.repos : []
  const repoListFailed = adoReady && !!repoList && (!repoList.ok || repoList.repos.length === 0)
  const folderRepo = ado.repository
  const resolvedRepo = folderRepo ? (listed.find(r => sameName(r, folderRepo)) ?? folderRepo) : ''
  const repos = resolvedRepo && !listed.includes(resolvedRepo) ? [resolvedRepo, ...listed] : listed
  const repo = pickedRepo && repos.includes(pickedRepo) ? pickedRepo : resolvedRepo || repos[0] || ''
  const setEditorNav = useEditorStore(s => s.setEditorNav)
  const showToast = useToastStore(s => s.showToast)
  const t = useI18n()

  // Work item id from the folder (Settings › Git › worktree), else the branch convention
  // `feature/{id}` or `bugfix/{id}-text` (NewWorktreeDialog).
  const layout = useSettingsStore(s => s.settings.worktreeLayout) ?? DEFAULT_WORKTREE_LAYOUT
  const workItemId = folderKind(worktreePath, basePath, layout)?.id ?? pbiIdFromBranch(branch)

  // Commit/PR title with the ADO work item reference (#<id>), unless already present.
  const fullMessage = workItemId !== null && !/#\d+|AB#\d+/i.test(message)
    ? `#${workItemId} : ${message.trim()}`
    : message.trim()

  // Work items to link: EVERY `#<id>` in the commit message (PBI/task/bug, N of them),
  // falling back to the branch id when the message has none.
  const workItemIds = (() => {
    const ids = new Set<number>()
    for (const m of fullMessage.matchAll(/#(\d+)/g)) ids.add(parseInt(m[1], 10))
    if (ids.size === 0 && workItemId !== null) ids.add(workItemId)
    return [...ids]
  })()

  // Stacked worktree: while the parent is open the PR targets the parent; once
  // the parent is in develop the target becomes develop (and the link is dropped).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const branch = await window.electronAPI.git.currentBranch(worktreePath)
        const list = await window.electronAPI.worktree.stack(repoPath)
        if (!cancelled) setStackInfo(list.find(i => i.branch === branch) || null)
      } catch {
        if (!cancelled) setStackInfo(null)
      }
    })()
    return () => { cancelled = true }
  }, [worktreePath, repoPath])

  const stacked = !!stackInfo
  const targetBranch = stackInfo && stackInfo.state === 'open' ? stackInfo.parent : 'develop'
  const mergeRef = stackInfo && stackInfo.state === 'open' ? stackInfo.mergeRef : 'origin/develop'
  const absorbed = stackInfo?.state === 'absorbed'

  /** Removes this worktree like the list does: its own children go back to develop first. */
  const disposeWorktree = async (done: string): Promise<boolean> => {
    const branch = await window.electronAPI.git.currentBranch(worktreePath)
    const affected = branch
      ? await window.electronAPI.worktree.retargetChildren(repoPath, branch).catch(() => [] as string[])
      : []
    const res = await window.electronAPI.worktree.remove(repoPath, worktreePath)
    if (!res.ok) { showToast(tr('worktree not removed: {error}', { error: res.error || tr('removal failed') }), 'error'); return false }
    if (res.warning) showToast(res.warning, 'error')
    else showToast(withChildren(done, affected.length, tr))
    return true
  }

  /** Absorbed child: its work is already in the parent, so the worktree is disposable. */
  const removeAbsorbedChild = async () => {
    setRemovingChild(true)
    try {
      if (await disposeWorktree(tr('child worktree removed'))) onDone()
    } finally {
      setRemovingChild(false)
    }
  }

  /** After the PR: drop a stale stack link, then remove the worktree when nothing is left on its branch. */
  const afterPr = async () => {
    const branch = await window.electronAPI.git.currentBranch(worktreePath).catch(() => '')
    // promotion: the base was develop (parent already merged) → drop the link
    if (stacked && targetBranch === 'develop' && branch) {
      try {
        await window.electronAPI.worktree.clearLink(repoPath, branch)
        setStackInfo(null)
        showToast(tr('worktree promoted on develop (link to the parent removed)'))
      } catch { /* non bloccante */ }
    }
    // the main checkout stays (git lists it first, wherever the worktrees live; with a bare
    // repository that first entry is the repository itself); unknown list: keep
    const list = await window.electronAPI.worktree.list(repoPath).catch(() => null)
    if (!branch || !list || list.some((e, i) => samePath(e.path, worktreePath) && (e.bare || i === 0))) return
    const [status, stack] = await Promise.all([
      window.electronAPI.git.status(worktreePath),
      window.electronAPI.worktree.stack(repoPath)
    ]).catch(() => [null, null])
    // uncommitted or unpushed work, or worktrees stacked on it: keep it
    if (!status || !status.isClean || !status.tracking || status.ahead > 0) return
    if (!stack || stack.some(i => i.parent === branch)) {
      showToast(tr('worktree kept: it has worktrees stacked on it'))
      return
    }
    if (await disposeWorktree(tr('worktree completed and removed'))) onDone()
  }

  const retryPr = async () => {
    if (await createPr()) await afterPr()
  }

  const updateStep = (index: number, patch: Partial<StepLog>) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s))
  }

  const createPr = async () => {
    if (!connection || !repo) {
      updateStep(6, { status: 'warn', detail: tr('ADO not connected or repository not selected: PR not created') })
      setPrFailed(true)
      return false
    }
    updateStep(6, { status: 'running', detail: undefined })
    // the main-process ADO service serves one connection at a time
    if (!(await window.electronAPI.ado.use(connection.id))) {
      updateStep(6, { status: 'warn', detail: tr('{error}: PR not created', { error: tr('PAT missing or unreadable: enter it in Settings › Azure DevOps › Connections') }) })
      setPrFailed(true)
      return false
    }
    const branch = await window.electronAPI.git.currentBranch(worktreePath)
    const result = await window.electronAPI.ado.createPr(connection.project, repo, {
      sourceRef: branch,
      targetRef: targetBranch,
      title: fullMessage,
      description: `Automatic PR from worktree complete flow.\n\n${fullMessage}`,
      autoComplete: autoComplete,
      workItemIds: workItemIds.length > 0 ? workItemIds : undefined
    })
    if (result) {
      setPrCreated(result.id)
      setPrMode(result.mode)
      setPrFailed(false)
      setCompleted(true)
      updateStep(6, {
        status: 'ok',
        detail: result.mode === 'completed' ? tr('PR #{id} completed', { id: result.id }) : result.mode === 'autocomplete' ? tr('PR #{id} in autocomplete', { id: result.id }) : tr('PR #{id} open', { id: result.id })
      })
      showToast(result.mode === 'completed' ? tr('PR #{id} completed', { id: result.id }) : result.mode === 'autocomplete' ? tr('PR #{id} created with autocomplete', { id: result.id }) : tr('PR #{id} created without autocomplete', { id: result.id }))
      return true
    }
    updateStep(6, { status: 'warn', detail: tr('PR creation failed (ADO)') })
    setPrFailed(true)
    return false
  }

  const run = async () => {
    if (!message.trim() || isRunning) return
    setIsRunning(true)
    setConflicts([])
    setPrCreated(null)
    setPrMode(null)
    const initial = [
      { label: tr('stage all changes'), status: 'pending' as const },
      { label: 'commit', status: 'pending' as const },
      { label: tr('push feature branch'), status: 'pending' as const },
      { label: 'fetch', status: 'pending' as const },
      { label: `merge ${targetBranch}`, status: 'pending' as const },
      { label: tr('push after merge'), status: 'pending' as const },
      { label: tr('create pull request → {branch}', { branch: targetBranch }), status: 'pending' as const }
    ]
    setSteps(initial)

    try {
      // 1. stage
      updateStep(0, { status: 'running' })
      await window.electronAPI.git.stageAll(worktreePath)
      updateStep(0, { status: 'ok' })

      // 2. commit
      updateStep(1, { status: 'running' })
      await window.electronAPI.git.commit(worktreePath, fullMessage)
      updateStep(1, { status: 'ok' })

      // 3. push upstream
      updateStep(2, { status: 'running' })
      await window.electronAPI.git.pushWithUpstream(worktreePath)
      updateStep(2, { status: 'ok' })

      // 4. fetch
      updateStep(3, { status: 'running' })
      await window.electronAPI.git.fetch(worktreePath)
      updateStep(3, { status: 'ok' })

      // 5. merge the base (the parent while stacked, develop otherwise)
      updateStep(4, { status: 'running' })
      const merge = await window.electronAPI.git.merge(worktreePath, mergeRef)
      if (!merge.ok) {
        setConflicts(merge.conflicts)
        updateStep(4, { status: 'error', detail: tr('conflicts: {files}', { files: merge.conflicts.join(', ') || merge.message.slice(0, 120) }) })
        showToast(tr('merge conflicts found: resolve them in the editor'), 'error')
        // Stop here; let the user resolve and re-run
        setSteps(prev => prev.map((s, i) => i > 4 ? { ...s, status: 'pending' } : s))
        setIsRunning(false)
        return
      }
      updateStep(4, { status: 'ok' })

      // 6. push again (and publish the parent branch: the PR targets it)
      updateStep(5, { status: 'running' })
      await window.electronAPI.git.push(worktreePath)
      if (stacked && targetBranch !== 'develop') {
        await window.electronAPI.git.pushBranch(worktreePath, targetBranch)
      }
      updateStep(5, { status: 'ok' })

      // 7. create PR (skip if a PR was already created in a previous run)
      updateStep(6, { status: 'running' })
      let prOk: boolean
      if (prCreated !== null) {
        updateStep(6, { status: 'ok', detail: tr('PR #{id} already created', { id: prCreated }) })
        prOk = true
      } else {
        prOk = await createPr()
      }
      setCompleted(prOk)
      if (prOk) await afterPr()
      setIsRunning(false)
    } catch (e) {
      const i = steps.findIndex(s => s.status === 'running')
      updateStep(i >= 0 ? i : 0, { status: 'error', detail: (e as Error).message })
      showToast(tr('error while completing'), 'error')
      setIsRunning(false)
    }
  }

  const openConflictInEditor = (file: string) => {
    setEditorNav({ rootPath: worktreePath, filePath: joinPath(worktreePath, file), line: 1 })
  }

  const stepIcon = (s: StepLog) => {
    if (s.status === 'running') return <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
    if (s.status === 'ok') return <CheckCircle2 size={12} style={{ color: 'var(--success-color)' }} />
    if (s.status === 'error') return <XCircle size={12} style={{ color: 'var(--error-color)' }} />
    if (s.status === 'warn') return <AlertTriangle size={12} style={{ color: 'var(--warning-color)' }} />
    return <span style={{ width: '12px', display: 'inline-block' }} />
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, backdropFilter: 'blur(2px)'
    }}>
      <div style={{
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', width: '520px', maxHeight: '90vh',
        padding: '22px', fontFamily: 'var(--font-mono)', overflow: 'auto'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, fontSize: 'calc(14px * var(--ui-text-scale, 1))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitPullRequest size={15} style={{ color: 'var(--accent-color)' }} />
            {t('complete worktree')}
          </h3>
          <button onClick={onClose} title={t('close')} data-tip-desc={t('close this panel or dialog')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px',
              background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}>
            <X size={12} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* no connection, or the folder's repository is not clear: choose it here, before
              starting (its «configura in Impostazioni» leaves the panel and would drop a running flow) */}
          {!adoReady && ado.status !== 'loading' && !isRunning && <AdoRepoChooser state={ado} compact />}

          {((!adoReady && ado.status !== 'loading') || repoListFailed) && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '8px 10px',
              background: 'var(--warning-bg)', border: '1px solid var(--warning-color)',
              borderRadius: 'var(--radius-sm)', color: 'var(--warning-color)',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', lineHeight: 1.6
            }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {!adoReady
                  ? <>{t('Without an Azure DevOps repository for this folder the pull request will not be created.')}</>
                  : <>{t('Azure DevOps does not return the repositories of the project')} <b>{connection?.project}</b>{repoList && !repoList.ok ? <> ({repoList.error})</> : null}: {t('the pull request may fail.')}</>}
                {' '}{t('Set it up in Settings › Azure DevOps before starting, or go ahead with commit, push and merge only.')}
              </span>
            </div>
          )}

          {stacked && !absorbed && stackInfo && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '8px 10px',
              background: targetBranch === 'develop' ? 'var(--warning-bg)' : 'var(--accent-bg)',
              border: `1px solid ${targetBranch === 'develop' ? 'var(--warning-color)' : 'var(--accent-color)'}`,
              borderRadius: 'var(--radius-sm)',
              color: targetBranch === 'develop' ? 'var(--warning-color)' : 'var(--accent-color)',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', lineHeight: 1.6
            }}>
              <Layers size={12} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {t('worktree stacked on')} <b>{stackInfo.parent}</b> — {stackInfo.detail}.<br />
                {targetBranch === 'develop'
                  ? <>{t('the parent is already in develop: the PR will go to')} <b>develop</b> {t('and the link will be removed (promotion).')}</>
                  : <>{t('the PR will target')} <b>{stackInfo.parent}</b> ({t('alignment with')} <span style={{ fontFamily: 'var(--font-mono)' }}>{mergeRef}</span>).</>}
              </span>
            </div>
          )}

          {absorbed && stackInfo && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
              background: 'var(--success-bg)', border: '1px solid var(--success-color)',
              borderRadius: 'var(--radius-sm)', color: 'var(--success-color)',
              fontSize: 'calc(10px * var(--ui-text-scale, 1))', lineHeight: 1.6
            }}>
              <Layers size={12} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                {t('the work of this worktree is already inside')} <b>{stackInfo.parent}</b>: {t('there is nothing to complete.')}
              </span>
              <button onClick={removeAbsorbedChild} disabled={removingChild}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', height: '24px',
                  background: 'var(--bg-card)', border: '1px solid var(--success-color)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--success-color)', cursor: removingChild ? 'not-allowed' : 'pointer',
                  fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                }}>
                {removingChild ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={10} />}
                {t('remove worktree')}
              </button>
            </div>
          )}

          <label style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
            {t('commit message')}
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('e.g. {example}', { example: 'feat: add new endpoint' })}
              spellCheck={false}
              style={{
                display: 'block', width: '100%', marginTop: '4px', padding: '7px 10px',
                background: 'var(--bg-input)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', boxSizing: 'border-box', outline: 'none'
              }}
            />
            {fullMessage !== message.trim() && (
              <div style={{ marginTop: '4px', fontSize: 'calc(10px * var(--ui-text-scale, 1))', color: 'var(--accent-color)', fontFamily: 'var(--font-mono)' }}>
                {t('commit and PR title:')} <span style={{ color: 'var(--text-secondary)' }}>{fullMessage}</span>
              </div>
            )}
          </label>

          {adoReady && (
            <label style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
              {t('repository')}
              <select value={repo} onChange={(e) => setPickedRepo(e.target.value)}
                disabled={repos.length === 0}
                style={{
                  display: 'block', width: '100%', marginTop: '4px', padding: '7px 10px',
                  background: 'var(--bg-input)', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', boxSizing: 'border-box', outline: 'none'
                }}>
                {repos.length === 0 ? <option value="">{t('loading repositories...')}</option> : repos.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}

          {adoReady && (
            <div
              onClick={() => setAutoComplete(!autoComplete)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
                padding: '6px 10px', background: 'var(--bg-card)',
                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                userSelect: 'none'
              }}>
              <span style={{
                width: '12px', height: '12px', flexShrink: 0, borderRadius: '3px',
                border: '1px solid var(--accent-color)',
                background: autoComplete ? 'var(--accent-color)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {autoComplete && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--text-inverse)' }} />}
              </span>
              {t('PR auto-complete (default: no)')}
            </div>
          )}

          {steps.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px' }}>
              {steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
                  {stepIcon(s)}
                  <span>{s.label}</span>
                  {s.detail && <span style={{ color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {s.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {conflicts.length > 0 && (
            <div style={{
              padding: '8px 10px', background: 'var(--error-bg)', color: 'var(--error-color)',
              borderRadius: 'var(--radius-sm)', fontSize: 'calc(10px * var(--ui-text-scale, 1))'
            }}>
              <div style={{ marginBottom: '4px', fontWeight: 600 }}>{t('Resolve the conflicts, then run "complete" again:')}</div>
              {conflicts.slice(0, 8).map(f => (
                <button key={f} onClick={() => openConflictInEditor(f)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px', background: 'none',
                    border: 'none', color: 'var(--error-color)', cursor: 'pointer',
                    fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', padding: '1px 0'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline' }}
                  onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none' }}>
                  <FileCode size={9} /> {f}
                </button>
              ))}
            </div>
          )}

          {prCreated !== null && (
            <div style={{ padding: '8px 10px', background: 'var(--success-bg)', color: 'var(--success-color)', borderRadius: 'var(--radius-sm)', fontSize: 'calc(10px * var(--ui-text-scale, 1))' }}>
              {prMode === 'autocomplete' ? t('Pull request #{id} created towards {branch} (autocomplete)', { id: prCreated, branch: targetBranch })
                : prMode === 'completed' ? t('Pull request #{id} created towards {branch} (completed)', { id: prCreated, branch: targetBranch })
                  : t('Pull request #{id} created towards {branch}', { id: prCreated, branch: targetBranch })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            {completed ? (
              <button onClick={onClose} style={{
                padding: '7px 16px', background: 'var(--success-bg)', border: '1px solid var(--success-color)',
                borderRadius: 'var(--radius-md)', color: 'var(--success-color)', cursor: 'pointer',
                fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
              }}>{t('done')}</button>
            ) : prFailed ? (
              <>
                <button onClick={onClose} style={{
                  padding: '7px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer',
                  fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
                }}>{t('close')}</button>
                <button onClick={retryPr} disabled={isRunning}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 16px',
                    background: isRunning ? 'var(--bg-disabled)' : 'var(--warning-color)',
                    border: 'none', borderRadius: 'var(--radius-md)',
                    color: isRunning ? 'var(--text-muted)' : 'var(--text-inverse)',
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                  }}>
                  {isRunning ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : t('retry PR')}
                </button>
              </>
            ) : (
              <>
                <button onClick={onClose} style={{
                  padding: '7px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer',
                  fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
                }}>{t('close')}</button>
                <button onClick={run} disabled={!message.trim() || isRunning || absorbed}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 16px',
                    background: message.trim() && !isRunning && !absorbed ? 'var(--accent-color)' : 'var(--bg-disabled)',
                    border: 'none', borderRadius: 'var(--radius-md)',
                    color: message.trim() && !isRunning && !absorbed ? 'var(--text-inverse)' : 'var(--text-muted)',
                    cursor: message.trim() && !isRunning && !absorbed ? 'pointer' : 'not-allowed',
                    fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                  }}>
                  {isRunning ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : adoReady ? t('start') : t('start without PR')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
