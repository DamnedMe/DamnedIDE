// Kind of a changed file (controller, service, DB, test, ...) for the grouped
// lists of Worktree › Changes and of the editor's changes panel. Pure, no React:
// shared by FileDiffList, WorktreeChanges and scripts/change-groups.check.ts.
// Labels are English i18n keys: the UI shows them with t(label).

export type ChangeGroupId =
  | 'controller' | 'service' | 'repository' | 'db' | 'model' | 'contract'
  | 'helper' | 'ui' | 'test' | 'config' | 'docs' | 'other'

/** display order of the groups */
export const CHANGE_GROUPS: { id: ChangeGroupId; label: string }[] = [
  { id: 'controller', label: 'Controller' },
  { id: 'service', label: 'Service' },
  { id: 'repository', label: 'Repository' },
  { id: 'db', label: 'DB (migration, context)' },
  { id: 'model', label: 'Model / DTO' },
  { id: 'contract', label: 'Interfaces' },
  { id: 'helper', label: 'Helper / Utility' },
  { id: 'ui', label: 'UI (frontend)' },
  { id: 'test', label: 'Test' },
  { id: 'config', label: 'Configuration' },
  { id: 'docs', label: 'Documentation' },
  { id: 'other', label: 'Other' }
]

type Rule = (dirs: string[], name: string, rawName: string) => boolean

const has = (dirs: string[], ...names: string[]) => dirs.some(d => names.includes(d))

// first match wins: a test controller is a test, a migration's .cs is DB
const RULES: [ChangeGroupId, Rule][] = [
  ['test', (d, n) =>
    d.some(s => /tests?$/.test(s) || s === 'testing' || s === '__tests__' || s === 'e2e') ||
    /tests?\.cs$|\.(spec|test)\.[jt]sx?$/.test(n)],
  // Angular suffixes win over backend folder names (store/services, requests, migrations)
  ['ui', (_d, n) => /\.component\.(ts|html|scss|css)$|\.(directive|pipe|guard|interceptor)\.ts$/.test(n)],
  ['docs',(d, n) => /\.(md|mdx|txt|adoc)$/.test(n) || has(d, 'docs', 'doc')],
  ['db', (d, n) =>
    has(d, 'migrations', 'migration') ||
    /(dbcontext|modelsnapshot)\.cs$|\.sql$/.test(n) ||
    (/context\.cs$/.test(n) && has(d, 'data', 'persistence', 'infrastructure')) ||
    (/configuration\.cs$/.test(n) && has(d, 'configurations', 'entityconfigurations'))],
  ['config', (d, n) =>
    /^appsettings.*\.json$|\.(csproj|slnx?|props|targets|ya?ml)$|^directory\.build\.|^(package|package-lock|angular|launchsettings)\.json$|^tsconfig.*\.json$|^dockerfile|^\.(editorconfig|gitignore)$|^(nuget|web)\.config$/.test(n) ||
    (/^environment.*\.ts$/.test(n) && has(d, 'environments'))],
  ['controller', (d, n) => has(d, 'controllers') || /controller\.cs$/.test(n)],
  // before service/repository: IStoreService.cs is an interface, not a service
  ['contract', (d, _n, raw) => has(d, 'interfaces') || /^I[A-Z][A-Za-z0-9_]*\.cs$/.test(raw)],
  ['service', (d, n) => has(d, 'services') || /service\.cs$|\.service\.ts$/.test(n)],
  ['repository', (d, n) => has(d, 'repositories', 'repository') || /repository\.cs$/.test(n)],
  ['model', (d, n) =>
    has(d, 'dtos', 'dto', 'entities', 'models', 'model', 'request', 'requests', 'response', 'responses', 'enum', 'enums', 'viewmodels') ||
    /(dto|request|response)\.cs$|\.(models?|dtos?|enums?)\.ts$/.test(n)],
  ['helper', (d, n) =>
    has(d, 'helpers', 'helper', 'utils', 'utilities', 'common', 'extensions', 'functions', 'validators') ||
    /(helper|extensions|utils)\.cs$|\.(utils?|helper|functions?|validators?)\.ts$/.test(n)],
  ['ui', (d, n) => has(d, 'components', 'pages', 'views') || /\.(tsx|jsx|vue|html|scss|css)$/.test(n)]
]

const split = (path: string) => path.split(/[\\/]+/).filter(Boolean)

/** group of a repo-relative path (either separator, case-insensitive) */
export function classifyChange(path: string): ChangeGroupId {
  const raw = split(path)
  const rawName = raw.pop() ?? ''
  const dirs = raw.map(s => s.toLowerCase())
  const name = rawName.toLowerCase()
  return RULES.find(([, rule]) => rule(dirs, name, rawName))?.[0] ?? 'other'
}

const lastSep = (path: string) => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
// git lists a nested repo (the IDE's own .worktrees/<name>/) as a folder with a trailing slash
const trimSep = (path: string) => path.replace(/[\\/]+$/, '')

export function fileNameOf(path: string): string {
  const p = trimSep(path)
  return p.slice(lastSep(p) + 1)
}

/** folder of the path without the trailing separator, '' at the repo root */
export function dirOf(path: string): string {
  const p = trimSep(path)
  const i = lastSep(p)
  return i < 0 ? '' : trimSep(p.slice(0, i))
}

/** non-empty groups in CHANGE_GROUPS order, files by name then path */
export function groupChanges<T extends { path: string }>(files: T[]): { id: ChangeGroupId; label: string; files: T[] }[] {
  const by = new Map<ChangeGroupId, T[]>()
  for (const f of files) {
    const id = classifyChange(f.path)
    const a = by.get(id)
    if (a) a.push(f); else by.set(id, [f])
  }
  return CHANGE_GROUPS.filter(g => by.has(g.id)).map(g => ({
    ...g,
    files: by.get(g.id)!.sort((a, b) => fileNameOf(a.path).localeCompare(fileNameOf(b.path)) || a.path.localeCompare(b.path))
  }))
}
