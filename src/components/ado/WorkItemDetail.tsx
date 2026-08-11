import { useEffect, useState } from 'react'
import { AdoWorkItem } from '../../types/ado'
import { Loader2, ExternalLink } from 'lucide-react'

interface WorkItemDetailProps {
  workItemId: number
  project: string
}

export function WorkItemDetail({ workItemId, project }: WorkItemDetailProps) {
  const [workItem, setWorkItem] = useState<AdoWorkItem | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    loadWorkItem()
  }, [workItemId])

  const loadWorkItem = async () => {
    setIsLoading(true)
    try {
      const wi = await window.electronAPI.ado.workItem(project, workItemId)
      setWorkItem(wi)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '32px', background: 'var(--bg-card)',
        border: '1px solid var(--border-color)', borderRadius: '6px'
      }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  if (!workItem) {
    return (
      <div style={{
        padding: '24px', textAlign: 'center', color: 'var(--text-secondary)',
        background: 'var(--bg-card)', border: '1px solid var(--border-color)',
        borderRadius: '6px', fontSize: '12px'
      }}>
        Seleziona un work item
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      padding: '16px',
      overflow: 'auto'
    }}>
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', marginBottom: '8px'
        }}>
          <span style={{
            fontSize: '11px', color: 'var(--text-secondary)',
            fontWeight: 600, textTransform: 'uppercase'
          }}>
            #{workItem.id} · {workItem.type}
          </span>
          {workItem.url && (
            <a href={workItem.url} target="_blank" rel="noreferrer"
              style={{ color: 'var(--text-secondary)', display: 'flex' }}>
              <ExternalLink size={13} />
            </a>
          )}
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
          {workItem.title}
        </h3>
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <span>Stato: <strong>{workItem.state}</strong></span>
          <span>Assegnato: <strong>{workItem.assignedTo || '—'}</strong></span>
        </div>
      </div>
    </div>
  )
}
