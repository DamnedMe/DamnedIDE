import { useCallback, useEffect, useState } from 'react'
import { GitFileStatus } from '../../types/git'
import { FileDiffList } from '../git/FileDiffList'
import { ListPlus, RefreshCw, Loader2, GitCompare } from 'lucide-react'

interface ChangesPanelProps {
  repoPath: string
  onOpenDiff: (original: string, modified: string, path: string) => void
}

export function ChangesPanel({ repoPath, onOpenDiff }: ChangesPanelProps) {
  const [staged, setStaged] = useState<GitFileStatus[]>([])
  const [unstaged, setUnstaged] = useState<GitFileStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)

  const load = useCallback(async (initial = false) => {
    if (initial) setIsLoading(true)
    setError(null)
    try {
      const p = await window.electronAPI.git.porcelain(repoPath)
      const build = (list: { path: string; changeType: string }[], stagedFlag: boolean): GitFileStatus[] =>
        list.map(f => ({
          path: f.path,
          index: f.changeType === 'add' ? (stagedFlag ? 'A' : '?') : f.changeType === 'delete' ? 'D' : 'M',
          workingDir: f.changeType === 'add' ? '?' : f.changeType === 'delete' ? 'D' : 'M',
          staged: stagedFlag,
          unstaged: !stagedFlag,
          isNew: f.changeType === 'add',
          isModified: f.changeType === 'edit',
          isDeleted: f.changeType === 'delete',
          isRenamed: false
        })).sort((a, b) => a.path.localeCompare(b.path))
      setStaged(build(p.staged, true))
      setUnstaged(build(p.unstaged, false))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (initial) setIsLoading(false)
    }
  }, [repoPath])

  useEffect(() => {
    load(true)
    // Poll to track changes, but keep it light and skip when the window is hidden
    const timer = setInterval(() => { if (!document.hidden) load() }, 5000)
    return () => clearInterval(timer)
  }, [load])

  const handleStage = async (file: string) => {
    await window.electronAPI.git.stage(repoPath, [file])
    load()
  }

  const handleUnstage = async (file: string) => {
    await window.electronAPI.git.unstage(repoPath, [file])
    load()
  }

  const handleStageAll = async () => {
    await window.electronAPI.git.stageAll(repoPath)
    load()
  }

  const handleViewDiff = async (file: string) => {
    setActiveFile(file)
    const inStaged = staged.some(s => s.path === file)
    const inUnstaged = unstaged.some(u => u.path === file)
    let original = ''
    let modified = ''
    try {
      if (inUnstaged && !inStaged) {
        original = await window.electronAPI.git.showRef(repoPath, file, 'HEAD')
        modified = await window.electronAPI.fs.readFile(`${repoPath}\\${file}`)
      } else if (inStaged) {
        original = await window.electronAPI.git.showRef(repoPath, file, 'HEAD')
        modified = await window.electronAPI.git.showRef(repoPath, file, ':')
      }
    } catch { /* ignore */ }
    onOpenDiff(original, modified, file)
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
      </div>
    )
  }

  if (error) {
    return <div style={{ padding: '12px', color: 'var(--error-color)', fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>{error}</div>
  }

  const renderZone = (label: string, list: GitFileStatus[], accent: string) => {
    if (list.length === 0) return null
    return (
      <div>
        <div style={{
          padding: '3px 8px', fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontWeight: 700, color: accent,
          textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-mono)',
          borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-subtle)', flexShrink: 0
        }}>
          {label} — {list.length}
        </div>
        <FileDiffList
          files={list}
          onStage={handleStage}
          onUnstage={handleUnstage}
          onViewDiff={handleViewDiff}
          activeDiffFile={activeFile}
        />
      </div>
    )
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      minHeight: 0, overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
      }}>
        <GitCompare size={11} style={{ color: 'var(--accent-color)' }} />
        <span style={{ fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontWeight: 600 }}>
          changes ({staged.length + unstaged.length})
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          <button onClick={handleStageAll} title="stage all changes" data-tip-desc="stage every modified file at once"
            style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--success-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
            <ListPlus size={11} />
          </button>
          <button onClick={() => load()} title="refresh" data-tip-desc="reload the current data from the repository"
            style={{ display: 'flex', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
            <RefreshCw size={10} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {renderZone('staged changes', staged, 'var(--success-color)')}
        {renderZone('changes', unstaged, 'var(--warning-color)')}
        {staged.length === 0 && unstaged.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'calc(10px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)' }}>
            no changes
          </div>
        )}
      </div>
    </div>
  )
}
