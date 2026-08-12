import { useMemo } from 'react'
import { useSettingsStore } from './store'

export type Lang = 'en' | 'it'

// Lightweight i18n: keys are the English labels (fallback), `it` provides the
// Italian translation. Extend freely — missing keys fall back to English.
export const dict: Record<Lang, Record<string, string>> = {
  en: {},
  it: {
    worktree: 'Worktree',
    git: 'Git',
    ado: 'Azure DevOps',
    sql: 'SQL Server',
    editor: 'Editor',
    terminal: 'Terminale',
    settings: 'Impostazioni',
    'editor settings': 'impostazioni editor',
    'editor colors': 'colori editor',
    theme: 'tema',
    dark: 'scuro',
    light: 'chiaro',
    'primary color': 'colore primario',
    'font size': 'dimensione font',
    'icon size': 'dimensione icone',
    language: 'lingua',
    english: 'English',
    italian: 'Italiano',
    minimap: 'minimap',
    'tab size': 'dimensione tab',
    'line numbers': 'numeri di riga',
    'word wrap': 'a capo automatico',
    'font ligatures': 'legature font',
    'auto save': 'salvataggio automatico',
    'navigation keybindings': 'scorciatoie navigazione',
    on: 'on',
    off: 'off',
    relative: 'relativo',
    '2 spaces': '2 spazi',
    '4 spaces': '4 spazi',
    '8 spaces': '8 spazi',
    'VS Studio — Ctrl+- / Ctrl+Shift+-': 'VS Studio — Ctrl+- / Ctrl+Shift+-',
    'VS Code — Alt+Left / Alt+Right': 'VS Code — Alt+FrecciaSx / Alt+FrecciaDx',
    'reset colors': 'reimposta colori',
    'reset to defaults': 'ripristina impostazioni',
    'set current as standard theme': 'salva come tema standard',
    'reset default theme settings': 'ripristina tema standard',
    'new worktree': 'nuovo worktree',
    'PBI id': 'ID PBI',
    branch: 'branch',
    path: 'percorso',
    cancel: 'annulla',
    create: 'crea',
    feature: 'feature',
    bugfix: 'bugfix',
    'worktree type': 'tipo worktree',
    'feature branch': 'branch feature (feature/{id})',
    'bugfix branch': 'branch bugfix (bugfix/{id})',
    'open a git repository': 'apri un repository git',
    'to manage worktrees': 'per gestire i worktree',
    'open repo': 'apri repo',
    worktrees: 'worktrees',
    files: 'file',
    'main': 'main',
    detached: 'detached',
    hidden: 'nascosto',
    'all worktrees hidden': 'tutti i worktree nascosti',
    'no worktrees': 'nessun worktree',
    'hide from list': 'nascondi dalla lista',
    unhide: 'mostra',
    'unhide all': 'mostra tutti',
    'remove worktree': 'rimuovi worktree',
    'completa worktree': 'completa worktree',
    'hide hidden': 'nascondi i nascosti',
    'show hidden': 'mostra i nascosti'
  }
}

export function useI18n() {
  const lang = useSettingsStore(s => s.settings.language || 'en')
  return useMemo(() => {
    const table = dict[lang]
    return (key: string): string => table[key] ?? key
  }, [lang])
}
