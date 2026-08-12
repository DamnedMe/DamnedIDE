import { useEffect, useState } from 'react'
import { PanelContainer } from '../layout/PanelContainer'
import { ResizableSplitter } from '../layout/ResizableSplitter'
import { StagingArea } from './StagingArea'
import { CommitDialog } from './CommitDialog'
import { BranchList } from './BranchList'
import { useGitStore } from '../../store'
import { useI18n } from '../../i18n'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { GitFileStatus } from '../../types/git'

interface GitPanelProps {
  repoPath: string | null
}

export function GitPanel({ repoPath }: GitPanelProps) {
  const { status, setStatus, files, setFiles, branches, setBranches, isLoading, setLoading } = useGitStore()
  const [showCommit, setShowCommit] = useState(false)
  const t = useI18n()

  const loadStatus = async () => {
    if (!repoPath) return
    setLoading(true)
    try {
      const s = await window.electronAPI.git.status(repoPath)
      const allFiles: GitFileStatus[] = [
        ...s.created.map(f => ({ path: f, index: '?', workingDir: '?', staged: false, unstaged: false, isNew: true, isModified: false, isDeleted: false, isRenamed: false })),
        ...s.modified.map(f => ({ path: f, index: 'M', workingDir: 'M', staged: false, unstaged: true, isNew: false, isModified: true, isDeleted: false, isRenamed: false })),
        ...s.deleted.map(f => ({ path: f, index: 'D', workingDir: 'D', staged: false, unstaged: true, isNew: false, isModified: false, isDeleted: true, isRenamed: false })),
        ...(s.staged || []).map(f => ({ path: f, index: 'A', workingDir: ' ', staged: true, unstaged: false, isNew: false, isModified: false, isDeleted: false, isRenamed: false }))
      ]
      setStatus(s)
      setFiles(allFiles)
      const b = await window.electronAPI.git.branches(repoPath)
      setBranches(b)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (repoPath) loadStatus()
  }, [repoPath])

  if (!repoPath) {
    return (
      <PanelContainer title={t('git')}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: '20px',
          color: 'var(--text-muted)'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <FolderOpen size={28} strokeWidth={1} />
          </div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'calc(13px * var(--ui-text-scale, 1))' }}>open a repo to view changes</p>
        </div>
      </PanelContainer>
    )
  }

  const handleStage = async (file: string) => {
    await window.electronAPI.git.stage(repoPath, [file])
    loadStatus()
  }

  const handleUnstage = async (file: string) => {
    await window.electronAPI.git.unstage(repoPath, [file])
    loadStatus()
  }

  const handleCommit = async (message: string) => {
    await window.electronAPI.git.commit(repoPath, message)
    setShowCommit(false)
    loadStatus()
  }

  const modifiedFiles = files.filter(f => !f.staged && (f.isModified || f.isNew || f.isDeleted))
  const stagedFiles = files.filter(f => f.staged)

  return (
    <PanelContainer
      title="Git"
      actions={
        <ActionBtn onClick={loadStatus} title="refresh">
          <RefreshCw size={13} />
        </ActionBtn>
      }
    >
      <div style={{ height: '100%' }}>
        <ResizableSplitter direction="horizontal" defaultSize={220} minSize={160} maxSize={360}>
          <BranchList
            branches={branches}
            currentBranch={status?.current || ''}
            repoPath={repoPath}
            onBranchChanged={loadStatus}
          />
          <div style={{ padding: '0 0 0 0', overflow: 'auto' }}>
            <StagingArea
              modifiedFiles={modifiedFiles}
              stagedFiles={stagedFiles}
              onStage={handleStage}
              onUnstage={handleUnstage}
              onCommit={() => setShowCommit(true)}
            />
          </div>
        </ResizableSplitter>
      </div>

      {showCommit && (
        <CommitDialog
          onCommit={handleCommit}
          onClose={() => setShowCommit(false)}
        />
      )}
    </PanelContainer>
  )
}

function ActionBtn({ children, onClick, title }: {
  children: React.ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '5px 8px',
        height: '30px',
        background: 'var(--bg-card)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'all 0.15s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--accent-color)'
        e.currentTarget.style.borderColor = 'var(--accent-color)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-secondary)'
        e.currentTarget.style.borderColor = 'var(--border-color)'
      }}
    >
      {children}
    </button>
  )
}
