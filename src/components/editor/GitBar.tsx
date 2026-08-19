import { useState, useEffect } from 'react'
import { Loader2, GitBranch, Plus, Minus, Check, Download, Upload, RefreshCw, Diff, GitCommitHorizontal, Clock, GitMerge, X, FileCode } from 'lucide-react'
import { useToastStore } from '../../store'

interface GitBarProps {
  repoPath: string
  activeFile: string | null
  onShowText: (title: string, text: string) => void
  onShowBlame: (lines: { hash: string; author: string; date: string; line: string }[]) => void
  onShowHistory: (commits: { hash: string; date: string; message: string; authorName: string }[]) => void
}

export function GitBar({ repoPath, activeFile, onShowText, onShowBlame, onShowHistory }: GitBarProps) {
  const [branch, setBranch] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [branchB, setBranchB] = useState('develop')
  const showToast = useToastStore(s => s.showToast)

  useEffect(() => {
    window.electronAPI.git.currentBranch(repoPath).then(setBranch).catch(() => {})
  }, [repoPath])

  const run = async (id: string, fn: () => Promise<void>, okMsg?: string) => {
    if (busy) return
    setBusy(id)
    try {
      await fn()
      if (okMsg) showToast(okMsg)
    } catch (e) {
      showToast((e as Error).message || 'operazione fallita', 'error')
    } finally {
      setBusy(null)
    }
  }

  const stageActive = () => {
    if (!activeFile) return
    const rel = activeFile.startsWith(repoPath) ? activeFile.slice(repoPath.length + 1) : activeFile
    run('stage', async () => window.electronAPI.git.stage(repoPath, [rel]), 'staged')
  }

  const unstageActive = () => {
    if (!activeFile) return
    const rel = activeFile.startsWith(repoPath) ? activeFile.slice(repoPath.length + 1) : activeFile
    run('unstage', async () => window.electronAPI.git.unstage(repoPath, [rel]), 'unstaged')
  }

  const commit = () => {
    if (!commitMsg.trim()) return
    run('commit', async () => {
      await window.electronAPI.git.commit(repoPath, commitMsg.trim())
      setCommitMsg('')
    }, 'committed')
  }

  const showDiff = () => {
    if (!activeFile) return
    const rel = activeFile.startsWith(repoPath) ? activeFile.slice(repoPath.length + 1) : activeFile
    run('diff', async () => {
      const text = await window.electronAPI.git.diffFile(repoPath, rel)
      onShowText(`git diff — ${rel}`, text || '(no diff)')
    })
  }

  const showBlame = () => {
    if (!activeFile) return
    const rel = activeFile.startsWith(repoPath) ? activeFile.slice(repoPath.length + 1) : activeFile
    run('blame', async () => {
      const lines = await window.electronAPI.git.blame(repoPath, rel)
      onShowBlame(lines)
    })
  }

  const showHistory = () => {
    if (!activeFile) return
    const rel = activeFile.startsWith(repoPath) ? activeFile.slice(repoPath.length + 1) : activeFile
    run('history', async () => {
      const commits = await window.electronAPI.git.fileLog(repoPath, rel, 50)
      onShowHistory(commits)
    })
  }

  const showMergeDiff = () => {
    run('mergeDiff', async () => {
      const text = await window.electronAPI.diff.branch(repoPath, branch || 'HEAD', branchB)
      onShowText(`merge diff ${branch} → ${branchB}`, text || '(no diff)')
    })
  }

  const btn = (id: string, title: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <button onClick={onClick} disabled={disabled || busy === id} title={title}
      data-tip-desc={{
        'stage file': 'stage the active file',
        'unstage file': 'unstage the active file',
        'diff file': 'open the diff of the active file',
        'git blame': 'show who changed each line of the active file',
        'git history': 'show the commit history of the active file',
        'merge diff': 'show the diff between the current branch and the target branch',
        'pull': 'pull the latest changes from the remote',
        'push': 'push the local commits to the remote',
        'fetch': 'fetch the latest changes from the remote'
      }[title] || ''}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '22px', height: '18px', padding: 0, background: 'transparent',
        border: '1px solid transparent', borderRadius: 'var(--radius-sm)',
        color: 'var(--text-muted)', cursor: disabled || busy ? 'not-allowed' : 'pointer',
        opacity: disabled || busy ? 0.4 : 1
      }}
      onMouseEnter={(e) => { if (!disabled && !busy) e.currentTarget.style.color = 'var(--accent-color)' }}
      onMouseLeave={(e) => { if (!disabled && !busy) e.currentTarget.style.color = 'var(--text-muted)' }}>
      {busy === id ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : icon}
    </button>
  )

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
      padding: '3px 8px', borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-primary)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-color)', flexShrink: 0 }}>
        <GitBranch size={11} />
        {branch || '…'}
      </span>
      <span style={{ width: '1px', height: '14px', background: 'var(--border-subtle)', margin: '0 4px', flexShrink: 0 }} />

      {btn('stage', 'stage file', <Plus size={11} />, stageActive, !activeFile)}
      {btn('unstage', 'unstage file', <Minus size={11} />, unstageActive, !activeFile)}
      {btn('diff', 'diff file', <Diff size={11} />, showDiff, !activeFile)}
      {btn('blame', 'git blame', <GitCommitHorizontal size={11} />, showBlame, !activeFile)}
      {btn('history', 'git history', <Clock size={11} />, showHistory, !activeFile)}
      {btn('mergeDiff', 'merge diff', <GitMerge size={11} />, showMergeDiff)}

      <span style={{ width: '1px', height: '14px', background: 'var(--border-subtle)', margin: '0 4px', flexShrink: 0 }} />

      {btn('pull', 'pull', <Download size={11} />, () => run('pull', async () => window.electronAPI.git.pull(repoPath), 'pulled'))}
      {btn('push', 'push', <Upload size={11} />, () => run('push', async () => window.electronAPI.git.push(repoPath), 'pushed'))}
      {btn('fetch', 'fetch', <RefreshCw size={11} />, () => run('fetch', async () => window.electronAPI.git.fetch(repoPath), 'fetched'))}

      <span style={{ width: '1px', height: '14px', background: 'var(--border-subtle)', margin: '0 4px', flexShrink: 0 }} />

      <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
        placeholder="commit message"
        spellCheck={false}
        style={{
          flex: 1, minWidth: '100px', padding: '2px 6px', fontSize: 'calc(10px * var(--ui-text-scale, 1))',
          fontFamily: 'var(--font-mono)', background: 'var(--bg-input)',
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box'
        }}
      />
      <button onClick={commit} disabled={!commitMsg.trim() || busy === 'commit'} title="commit" data-tip-desc="commit the staged changes"
        style={{
          display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 10px', height: '18px',
          background: commitMsg.trim() && busy !== 'commit' ? 'var(--accent-color)' : 'var(--bg-disabled)',
          border: 'none', borderRadius: 'var(--radius-sm)',
          color: commitMsg.trim() && busy !== 'commit' ? 'var(--text-inverse)' : 'var(--text-muted)',
          cursor: commitMsg.trim() && busy !== 'commit' ? 'pointer' : 'not-allowed',
          fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
        }}>
        {busy === 'commit' ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={10} />}
        commit
      </button>

      <input value={branchB} onChange={(e) => setBranchB(e.target.value)} title="target branch for merge diff" data-tip-desc="compare the branches for the merge"
        spellCheck={false}
        style={{
          width: '80px', padding: '2px 6px', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)',
          background: 'var(--bg-input)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box'
        }}
      />
    </div>
  )
}
