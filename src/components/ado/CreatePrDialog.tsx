import { useEffect, useState } from 'react'
import { Loader2, X, GitPullRequest, RotateCw } from 'lucide-react'

interface CreatePrDialogProps {
  project: string
  repo: string
  onClose: () => void
  onCreated: () => void
}

export function CreatePrDialog({ project, repo, onClose, onCreated }: CreatePrDialogProps) {
  const [branches, setBranches] = useState<string[]>([])
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [autoComplete, setAutoComplete] = useState(false)
  const [descriptionTouched, setDescriptionTouched] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isLoadingCommits, setIsLoadingCommits] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.ado.branches(project, repo).then(b => {
      setBranches(b)
      if (b.length > 0) setTarget(b.find(x => x === 'develop' || x === 'main' || x === 'master') || b[0])
    }).catch(() => {})
  }, [project, repo])

  const fillFromCommits = async () => {
    if (!source || !target) return
    setIsLoadingCommits(true)
    try {
      const commits = await window.electronAPI.ado.commitsBetween(project, repo, source, target)
      if (commits.length > 0) {
        const d = '## Commits included\n\n' + commits.map(c => `- ${c.message}`).join('\n')
        setTitle(prev => prev || `merge ${source} into ${target}`)
        if (!descriptionTouched) setDescription(d)
      }
    } catch { /* ignore */ } finally {
      setIsLoadingCommits(false)
    }
  }

  const handleCreate = async () => {
    if (!source || !target || !title.trim()) return
    setError(null)
    setIsCreating(true)
    try {
      const result = await window.electronAPI.ado.createPr(project, repo, {
        sourceRef: source, targetRef: target, title: title.trim(), description, autoComplete
      })
      if (result) onCreated()
      else setError('Errore durante la creazione della PR (controlla branches/policies).')
    } finally { setIsCreating(false) }
  }

  const fieldLabel = (text: string) => (
    <label style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{text}</label>
  )

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: 'calc(14px * var(--ui-text-scale, 1))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitPullRequest size={15} style={{ color: 'var(--success-color)' }} />
            new pull request
          </h3>
          <button onClick={onClose} title="close"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '24px', height: '24px', background: 'transparent',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)', cursor: 'pointer'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--error-color)'; e.currentTarget.style.borderColor = 'var(--error-color)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)' }}>
            <X size={12} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            {fieldLabel('source branch')}
            <select value={source} onChange={(e) => setSource(e.target.value)} style={inputStyle}>
              <option value="">select...</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            {fieldLabel('target branch')}
            <select value={target} onChange={(e) => setTarget(e.target.value)} style={inputStyle}>
              <option value="">select...</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            {fieldLabel('title')}
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="PR title"
              spellCheck={false} style={inputStyle} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              {fieldLabel('description')}
              <button onClick={fillFromCommits} disabled={!source || !target || isLoadingCommits} title="fill from commits"
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px', background: 'none',
                  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-muted)', cursor: source && target ? 'pointer' : 'not-allowed',
                  fontSize: 'calc(9px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', padding: '2px 6px',
                  opacity: source && target ? 1 : 0.5
                }}>
                {isLoadingCommits ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCw size={9} />}
                from commits
              </button>
            </div>
            <textarea value={description} onChange={(e) => { setDescription(e.target.value); setDescriptionTouched(true) }}
              placeholder="auto-filled from commits"
              spellCheck={false} rows={8}
              style={{ ...inputStyle, resize: 'vertical', minHeight: '110px', lineHeight: 1.5 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" checked={autoComplete} onChange={(e) => setAutoComplete(e.target.checked)}
              style={{ accentColor: 'var(--accent-color)' }} />
            <span style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)' }}>auto-complete when policies pass</span>
          </div>

          {error && (
            <div style={{ padding: '8px 10px', background: 'var(--error-bg)', color: 'var(--error-color)', borderRadius: 'var(--radius-sm)', fontSize: 'calc(10px * var(--ui-text-scale, 1))' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <button onClick={onClose} style={secondaryBtnStyle}>cancel</button>
            <button onClick={handleCreate} disabled={!source || !target || !title.trim() || isCreating}
              style={{
                ...primaryBtnStyle,
                background: source && target && title.trim() ? 'var(--accent-color)' : 'var(--bg-disabled)',
                color: source && target && title.trim() ? 'var(--text-inverse)' : 'var(--text-muted)',
                cursor: source && target && title.trim() ? 'pointer' : 'not-allowed'
              }}>
              {isCreating ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : 'create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: '4px', padding: '7px 10px',
  background: 'var(--bg-input)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
  fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', boxSizing: 'border-box', outline: 'none'
}

const secondaryBtnStyle: React.CSSProperties = {
  padding: '7px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer',
  fontSize: 'calc(12px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)'
}

const primaryBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 16px',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 'calc(12px * var(--ui-text-scale, 1))',
  fontFamily: 'var(--font-mono)', fontWeight: 600
}
