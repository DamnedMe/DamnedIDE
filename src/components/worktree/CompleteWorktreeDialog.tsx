import { useState, useEffect } from 'react'
import { Loader2, X, GitPullRequest, CheckCircle2, XCircle, AlertTriangle, FileCode } from 'lucide-react'
import { useAdoStore, useEditorStore, useToastStore } from '../../store'

interface CompleteWorktreeDialogProps {
  worktreePath: string
  repoPath: string
  onClose: () => void
  onDone: () => void
}

interface StepLog {
  label: string
  status: 'pending' | 'running' | 'ok' | 'error' | 'warn'
  detail?: string
}

export function CompleteWorktreeDialog({ worktreePath, repoPath, onClose, onDone }: CompleteWorktreeDialogProps) {
  const [message, setMessage] = useState('')
  const [steps, setSteps] = useState<StepLog[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [prCreated, setPrCreated] = useState<number | null>(null)
  const [prFailed, setPrFailed] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [repos, setRepos] = useState<string[]>([])
  const [repo, setRepo] = useState('')
  const [autoComplete, setAutoComplete] = useState(false)
  const ado = useAdoStore(s => s.connection)
  const setEditorNav = useEditorStore(s => s.setEditorNav)
  const showToast = useToastStore(s => s.showToast)

  // Work item id from the branch/path convention `feature/{id}` (NewWorktreeDialog).
  const workItemId = (() => {
    const m = worktreePath.match(/feature[\\/](\d+)/)
    return m ? parseInt(m[1], 10) : null
  })()

  // Commit/PR title with the ADO work item reference (#<id>), unless already present.
  const fullMessage = workItemId !== null && !/#\d+|AB#\d+/i.test(message)
    ? `#${workItemId} : ${message.trim()}`
    : message.trim()

  // Work items to link: EVERY `#<id>` in the commit message (PBI/task/bug, N of them),
  // falling back to the branch id `feature/{id}` when the message has none.
  const workItemIds = (() => {
    const ids = new Set<number>()
    for (const m of fullMessage.matchAll(/#(\d+)/g)) ids.add(parseInt(m[1], 10))
    if (ids.size === 0 && workItemId !== null) ids.add(workItemId)
    return [...ids]
  })()

  useEffect(() => {
    if (!ado?.isConnected || !ado.organization || !ado.project) return
    window.electronAPI.ado.connect(ado.organization, ado.token)
      .then(() => window.electronAPI.ado.repositories(ado.project))
      .then(list => {
        setRepos(list)
        if (list.length > 0) {
          const repoName = repoPath.split(/[\\/]/).pop() || ''
          setRepo(list.includes(repoName) ? repoName : ado.repository && list.includes(ado.repository) ? ado.repository : list[0])
        }
      })
      .catch(() => {})
  }, [])

  const updateStep = (index: number, patch: Partial<StepLog>) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s))
  }

  const createPr = async () => {
    if (!ado?.isConnected || !ado.organization || !ado.project || !repo) {
      updateStep(6, { status: 'warn', detail: 'ADO non connesso o repository non selezionata: PR non creata' })
      setPrFailed(true)
      return false
    }
    updateStep(6, { status: 'running', detail: undefined })
    await window.electronAPI.ado.connect(ado.organization, ado.token)
    const branch = await window.electronAPI.git.currentBranch(worktreePath)
    const result = await window.electronAPI.ado.createPr(ado.project, repo, {
      sourceRef: branch,
      targetRef: 'develop',
      title: fullMessage,
      description: `Automatic PR from worktree complete flow.\n\n${fullMessage}`,
      autoComplete: autoComplete,
      workItemIds: workItemIds.length > 0 ? workItemIds : undefined
    })
    if (result) {
      setPrCreated(result.id)
      setPrFailed(false)
      setCompleted(true)
      updateStep(6, {
        status: 'ok',
        detail: result.mode === 'completed' ? `PR #${result.id} completata` : result.mode === 'autocomplete' ? `PR #${result.id} in autocomplete` : `PR #${result.id} aperta`
      })
      showToast(result.mode === 'completed' ? `PR #${result.id} completata` : result.mode === 'autocomplete' ? `PR #${result.id} creata con autocomplete` : `PR #${result.id} creata senza autocomplete`)
      return true
    }
    updateStep(6, { status: 'warn', detail: 'creazione PR fallita (ADO)' })
    setPrFailed(true)
    return false
  }

  const run = async () => {
    if (!message.trim() || isRunning) return
    setIsRunning(true)
    setConflicts([])
    setPrCreated(null)
    const initial = [
      { label: 'stage all changes', status: 'pending' as const },
      { label: 'commit', status: 'pending' as const },
      { label: 'push feature branch', status: 'pending' as const },
      { label: 'fetch', status: 'pending' as const },
      { label: 'merge develop', status: 'pending' as const },
      { label: 'push after merge', status: 'pending' as const },
      { label: 'create pull request', status: 'pending' as const }
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

      // 5. merge develop
      updateStep(4, { status: 'running' })
      const merge = await window.electronAPI.git.merge(worktreePath, 'origin/develop')
      if (!merge.ok) {
        setConflicts(merge.conflicts)
        updateStep(4, { status: 'error', detail: `conflitti: ${merge.conflicts.join(', ') || merge.message.slice(0, 120)}` })
        showToast('Conflitti di merge rilevati: risolvili nell\'editor', 'error')
        // Stop here; let the user resolve and re-run
        setSteps(prev => prev.map((s, i) => i > 4 ? { ...s, status: 'pending' } : s))
        setIsRunning(false)
        return
      }
      updateStep(4, { status: 'ok' })

      // 6. push again
      updateStep(5, { status: 'running' })
      await window.electronAPI.git.push(worktreePath)
      updateStep(5, { status: 'ok' })

      // 7. create PR (skip if a PR was already created in a previous run)
      updateStep(6, { status: 'running' })
      let prOk: boolean
      if (prCreated !== null) {
        updateStep(6, { status: 'ok', detail: `PR #${prCreated} già creata` })
        prOk = true
      } else {
        prOk = await createPr()
      }
      setCompleted(prOk)
      setIsRunning(false)
    } catch (e) {
      const i = steps.findIndex(s => s.status === 'running')
      updateStep(i >= 0 ? i : 0, { status: 'error', detail: (e as Error).message })
      showToast('Errore durante la finalizzazione', 'error')
      setIsRunning(false)
    }
  }

  const openConflictInEditor = (file: string) => {
    setEditorNav({ rootPath: worktreePath, filePath: `${worktreePath}\\${file}`, line: 1 })
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
            completa worktree
          </h3>
          <button onClick={onClose} title="close"
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
          <label style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
            commit message
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="es. feat: add new endpoint"
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
                commit e titolo PR: <span style={{ color: 'var(--text-secondary)' }}>{fullMessage}</span>
              </div>
            )}
          </label>

          {ado?.isConnected && (
            <label style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>
              repository
              <select value={repo} onChange={(e) => setRepo(e.target.value)}
                disabled={repos.length === 0}
                style={{
                  display: 'block', width: '100%', marginTop: '4px', padding: '7px 10px',
                  background: 'var(--bg-input)', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', boxSizing: 'border-box', outline: 'none'
                }}>
                {repos.length === 0 ? <option value="">loading repositories...</option> : repos.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}

          {ado?.isConnected && (
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
              auto-complete della PR (default: no)
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
              <div style={{ marginBottom: '4px', fontWeight: 600 }}>Risolvi i conflitti, poi riavvia "completa":</div>
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
              Pull request #{prCreated} creata verso develop{autoComplete ? ' (autocomplete)' : ''}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            {completed ? (
              <button onClick={onClose} style={{
                padding: '7px 16px', background: 'var(--success-bg)', border: '1px solid var(--success-color)',
                borderRadius: 'var(--radius-md)', color: 'var(--success-color)', cursor: 'pointer',
                fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
              }}>done</button>
            ) : prFailed ? (
              <>
                <button onClick={onClose} style={{
                  padding: '7px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer',
                  fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
                }}>close</button>
                <button onClick={createPr} disabled={isRunning}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 16px',
                    background: isRunning ? 'var(--bg-disabled)' : 'var(--warning-color)',
                    border: 'none', borderRadius: 'var(--radius-md)',
                    color: isRunning ? 'var(--text-muted)' : 'var(--text-inverse)',
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                  }}>
                  {isRunning ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : 'retry PR'}
                </button>
              </>
            ) : (
              <>
                <button onClick={onClose} style={{
                  padding: '7px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer',
                  fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
                }}>close</button>
                <button onClick={run} disabled={!message.trim() || isRunning}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 16px',
                    background: message.trim() && !isRunning ? 'var(--accent-color)' : 'var(--bg-disabled)',
                    border: 'none', borderRadius: 'var(--radius-md)',
                    color: message.trim() && !isRunning ? 'var(--text-inverse)' : 'var(--text-muted)',
                    cursor: message.trim() && !isRunning ? 'pointer' : 'not-allowed',
                    fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
                  }}>
                  {isRunning ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : 'start'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
