import { useEffect, useState } from 'react'
import { Loader2, GitPullRequest, GitCompare, FileCode, FilePlus, FileMinus, FileEdit, X, MessageSquare, Check, ThumbsDown, Merge } from 'lucide-react'
import { DiffViewer } from '../editor/DiffViewer'
import { useToastStore } from '../../store'
import { AdoPullRequestDetail, AdoPullRequestFile, AdoPullRequestThread } from '../../types/ado'

interface PullRequestDetailProps {
  project: string
  repo: string
  pr: AdoPullRequestDetail
  onClose: () => void
  onChanged: () => void
}

export function PullRequestDetail({ project, repo, pr, onClose, onChanged }: PullRequestDetailProps) {
  const [files, setFiles] = useState<AdoPullRequestFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [original, setOriginal] = useState('')
  const [modified, setModified] = useState('')
  const [threads, setThreads] = useState<AdoPullRequestThread[]>([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(true)
  const [isLoadingDiff, setIsLoadingDiff] = useState(false)
  const [isAction, setIsAction] = useState<'approve' | 'reject' | 'complete' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const showToast = useToastStore(s => s.showToast)

  useEffect(() => {
    setIsLoadingFiles(true)
    Promise.all([
      window.electronAPI.ado.pullRequestFiles(project, repo, pr.id),
      window.electronAPI.ado.pullRequestThreads(project, repo, pr.id).catch(() => [] as AdoPullRequestThread[])
    ]).then(([f, th]) => {
      setFiles(f)
      setThreads(th)
      if (f.length > 0) selectFile(f[0])
      setIsLoadingFiles(false)
    }).catch(() => setIsLoadingFiles(false))
  }, [pr.id])

  const selectFile = async (file: AdoPullRequestFile) => {
    setSelectedFile(file.path)
    setIsLoadingDiff(true)
    setOriginal('')
    setModified('')
    const needsOriginal = file.changeType !== 'add'
    const needsModified = file.changeType !== 'delete'
    try {
      const [orig, mod] = await Promise.all([
        needsOriginal && pr.targetCommitId
          ? window.electronAPI.ado.fileContent(project, repo, file.path, pr.targetCommitId).catch(() => '')
          : Promise.resolve(''),
        needsModified && pr.sourceCommitId
          ? window.electronAPI.ado.fileContent(project, repo, file.path, pr.sourceCommitId).catch(() => '')
          : Promise.resolve('')
      ])
      setOriginal(orig)
      setModified(mod)
    } finally {
      setIsLoadingDiff(false)
    }
  }

  const runAction = async (action: 'approve' | 'reject' | 'complete') => {
    setActionError(null)
    setIsAction(action)
    try {
      let ok = false
      if (action === 'complete') {
        if (!window.electronAPI.ado.completePr) throw new Error('API PR non disponibile: riavvia l\'app.')
        ok = await window.electronAPI.ado.completePr(project, repo, pr.id, pr.sourceCommitId)
      } else {
        if (!window.electronAPI.ado.setVote) throw new Error('API PR non disponibile: riavvia l\'app.')
        ok = await window.electronAPI.ado.setVote(project, repo, pr.id, action === 'approve' ? 10 : -10)
      }
      if (!ok) {
        setActionError(action === 'complete' ? 'Impossibile completare la PR (verifica permessi e policies).' : 'Impossibile aggiornare il voto (verifica di essere reviewer della PR).')
      } else {
        if (action === 'complete') showToast(`PR #${pr.id} completata`)
        else showToast(`PR #${pr.id} ${action === 'approve' ? 'approvata' : 'rejectata'}`)
        onChanged()
      }
    } catch (e) {
      setActionError((e as Error).message || 'Errore durante l\'operazione.')
    } finally {
      setIsAction(null)
    }
  }

  const detectLang = (path: string): string => {
    const m: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      cs: 'csharp', csproj: 'xml', sln: 'plaintext', json: 'json', xml: 'xml',
      html: 'html', css: 'css', scss: 'scss', sql: 'sql', md: 'markdown',
      yaml: 'yaml', yml: 'yaml', py: 'python', rs: 'rust', go: 'go', java: 'java',
      ps1: 'powershell', sh: 'shell', cshtml: 'html', razor: 'html'
    }
    return m[path.split('.').pop()?.toLowerCase() || ''] || 'plaintext'
  }

  const activeThreads = threads.filter(t => t.active)

  const changeIcon = (type: string) => {
    if (type === 'add') return <FilePlus size={11} style={{ color: 'var(--success-color)' }} />
    if (type === 'delete') return <FileMinus size={11} style={{ color: 'var(--error-color)' }} />
    return <FileEdit size={11} style={{ color: 'var(--warning-color)' }} />
  }

  const fileListPane = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-card)', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
        fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.5px'
      }}>
        <GitCompare size={11} />
        files — {files.length}
        {activeThreads.length > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--warning-color)' }}>
            <MessageSquare size={9} /> {activeThreads.length}
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {isLoadingFiles ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
          </div>
        ) : files.map(f => {
          const active = f.path === selectedFile
          return (
            <div key={f.path} onClick={() => selectFile(f)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px',
                cursor: 'pointer', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
                background: active ? 'var(--accent-bg)' : 'transparent',
                borderLeft: active ? '3px solid var(--accent-color)' : '3px solid transparent',
                color: active ? 'var(--accent-color)' : 'var(--text-primary)',
                transition: 'background 0.1s ease'
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}>
              {changeIcon(f.changeType)}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
            </div>
          )
        })}
      </div>
    </div>
  )

  const diffPane = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-card)', overflow: 'hidden' }}>
      {isLoadingDiff ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
        </div>
      ) : selectedFile ? (
        <DiffViewer
          original={original}
          modified={modified}
          filePath={selectedFile}
          language={detectLang(selectedFile)}
        />
      ) : (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', gap: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)'
        }}>
          <FileCode size={24} strokeWidth={1} />
          <div style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', textAlign: 'center' }}>
            select a file to see its diff
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
        padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-primary)', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          <GitPullRequest size={14} style={{ color: 'var(--success-color)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontWeight: 600, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>
              #{pr.id}: {pr.title}
            </div>
            <div style={{ fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {pr.sourceBranch} → {pr.targetBranch}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          <ActionBtn label="approve" color="var(--success-color)" icon={<Check size={10} />} busy={isAction === 'approve'} onClick={() => runAction('approve')} />
          <ActionBtn label="reject" color="var(--error-color)" icon={<ThumbsDown size={10} />} busy={isAction === 'reject'} onClick={() => runAction('reject')} />
          <ActionBtn label="complete" color="var(--accent-color)" icon={<Merge size={10} />} busy={isAction === 'complete'} onClick={() => runAction('complete')} />
        </div>
        <button onClick={onClose} title="close"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '22px', height: '20px', background: 'transparent',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)', cursor: 'pointer'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}>
          <X size={11} />
        </button>
      </div>
      {/* content */}
      {actionError && (
        <div style={{
          padding: '5px 10px', background: 'var(--error-bg)', color: 'var(--error-color)',
          fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
        }}>
          {actionError}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '4px', overflow: 'hidden' }}>
        <div style={{ width: '250px', flexShrink: 0, borderRight: '1px solid var(--border-subtle)' }}>
          {fileListPane}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>{diffPane}</div>
      </div>
    </div>
  )
}

function ActionBtn({ label, color, icon, busy, onClick }: {
  label: string
  color: string
  icon: React.ReactNode
  busy: boolean
  onClick: () => void
}) {
  return (
    <button onClick={onClick} disabled={busy} title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        padding: '2px 8px', height: '20px',
        background: 'transparent', border: `1px solid ${color}`,
        borderRadius: 'var(--radius-sm)', color,
        cursor: busy ? 'not-allowed' : 'pointer',
        fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600,
        opacity: busy ? 0.5 : 1
      }}>
      {busy ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : icon}
      {label}
    </button>
  )
}
