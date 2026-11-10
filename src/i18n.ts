import { useMemo } from 'react'
import { useSettingsStore } from './store'
import { IT as base } from './locales/it/base'
import { IT as shell } from './locales/it/shell-worktree'
import { IT as worktree } from './locales/it/worktree-terminal'
import { IT as editor } from './locales/it/editor'
import { IT as sqlGrid } from './locales/it/sql-grid'
import { IT as sqlTools } from './locales/it/sql-tools'
import { IT as adoGit } from './locales/it/ado-git'
import { IT as settings } from './locales/it/settings-layout'

export type Lang = 'en' | 'it'
export type Vars = Record<string, string | number>

// Keys are the English text (shown as is in English); `it` translates them, a missing key
// falls back to English. Placeholders: t('{n} files', { n: 3 }). Italian lives in
// src/locales/it/, one file per area; scripts/i18n.check.ts fails on a literal
// t('…') / tr('…') key without an Italian entry or on a key translated two ways.
export const dict: Record<Lang, Record<string, string>> = {
  en: {},
  it: { ...base, ...shell, ...worktree, ...editor, ...sqlGrid, ...sqlTools, ...adoGit, ...settings }
}

export const fill = (s: string, vars?: Vars): string =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s

const lookup = (lang: Lang, key: string, vars?: Vars): string => fill(dict[lang]?.[key] ?? key, vars)

/** Outside React (store actions, module helpers): the language at call time. */
export const tr = (key: string, vars?: Vars): string =>
  lookup(useSettingsStore.getState().settings.language || 'en', key, vars)

export function useI18n() {
  const lang = useSettingsStore(s => s.settings.language || 'en')
  return useMemo(() => (key: string, vars?: Vars): string => lookup(lang, key, vars), [lang])
}
