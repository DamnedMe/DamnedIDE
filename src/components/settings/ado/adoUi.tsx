import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import { useAdoSettingsStore } from '../../../store'
import type { AdoConnectionConfig, AdoRepoList, AdoRepoRef } from '../../../shared/adoSettings'
import { controlStyle } from '../ui'

// Helpers shared by the Azure DevOps settings pages.

/** `org / project` */
export const connectionLabel = (c: Pick<AdoConnectionConfig, 'organization' | 'project'>): string =>
  `${c.organization} / ${c.project}`

/** Reads the repository catalog once when the page opens (the main process caches it). */
export function useCatalogOnMount(): void {
  const loadCatalog = useAdoSettingsStore(s => s.loadCatalog)
  useEffect(() => { void loadCatalog() }, [loadCatalog])
}

/** The repositories of one connection, '' list while not read or failed. */
export function reposOf(catalog: Record<string, AdoRepoList | undefined>, id: string): string[] {
  const list = catalog[id]
  return list?.ok ? list.repos : []
}

const SEP = '\n'
export const encodeRef = (r: AdoRepoRef): string => `${r.connectionId}${SEP}${r.repository}`
export function decodeRef(v: string): AdoRepoRef | null {
  const i = v.indexOf(SEP)
  return i > 0 ? { connectionId: v.slice(0, i), repository: v.slice(i + 1) } : null
}

/**
 * A repository picker grouped per connection (`<optgroup label="org / project">`).
 * `refs` limits the choice (folder candidates); without it every readable
 * repository of every connection is offered. The current value is always listed,
 * even when the catalog does not have it (not read yet, renamed, failed).
 */
export function RepoRefSelect({ connections, catalog, refs, value, onChange, placeholder, title, tip, style, disabled }: {
  connections: AdoConnectionConfig[]
  catalog: Record<string, AdoRepoList | undefined>
  refs?: AdoRepoRef[]
  value: AdoRepoRef | null
  onChange: (ref: AdoRepoRef) => void
  placeholder?: string
  title?: string
  tip?: string
  style?: CSSProperties
  disabled?: boolean
}) {
  const groups = connections.map(c => {
    const names = refs
      ? refs.filter(r => r.connectionId === c.id).map(r => r.repository)
      : reposOf(catalog, c.id)
    const list = [...names]
    if (value && value.connectionId === c.id && !list.some(n => n === value.repository)) list.unshift(value.repository)
    return { c, list }
  }).filter(g => g.list.length > 0)
  const known = (r: AdoRepoRef) => {
    const list = catalog[r.connectionId]
    return !list?.ok || list.repos.some(n => n === r.repository)
  }
  return (
    <select
      value={value ? encodeRef(value) : ''}
      onChange={(e) => { const ref = decodeRef(e.target.value); if (ref) onChange(ref) }}
      title={title}
      data-tip-desc={tip}
      disabled={disabled}
      style={{ ...controlStyle, padding: '0 6px', cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
    >
      {!value && <option value="" disabled>{placeholder ?? 'scegli la repository…'}</option>}
      {groups.map(({ c, list }) => (
        <optgroup key={c.id} label={connectionLabel(c)}>
          {list.map(name => {
            const ref = { connectionId: c.id, repository: name }
            return (
              <option key={name} value={encodeRef(ref)}>
                {name}{known(ref) ? '' : ' (non trovata nel catalogo)'}
              </option>
            )
          })}
        </optgroup>
      ))}
    </select>
  )
}

/** A repository name of one connection; `special` options come first (automatic, none). */
export function RepoNameSelect({ repos, catalogRead, value, onChange, special, title, tip, style }: {
  repos: string[]
  /** the connection's catalog was read: a saved name missing from it is flagged */
  catalogRead: boolean
  value: string
  onChange: (v: string) => void
  special: { value: string; label: string }[]
  title?: string
  tip?: string
  style?: CSSProperties
}) {
  const isSpecial = special.some(s => s.value === value)
  const list = !isSpecial && value && !repos.some(r => r === value) ? [value, ...repos] : repos
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title={title} data-tip-desc={tip}
      style={{ ...controlStyle, padding: '0 6px', cursor: 'pointer', ...style }}>
      {special.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      {list.length > 0 && (
        <optgroup label="repository">
          {list.map(r => (
            <option key={r} value={r}>{r}{catalogRead && !repos.includes(r) ? ' (non trovata nel catalogo)' : ''}</option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
