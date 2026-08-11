import type { editor } from 'monaco-editor'
import type { ThemeColorConfig } from '../../store'

export const THEME_DARK = 'damned-dark'
export const THEME_LIGHT = 'damned-light'
const CONTROL_FLOW = ['if', 'else', 'for', 'foreach', 'while', 'do', 'return', 'break', 'continue', 'goto', 'switch', 'case', 'throw', 'try', 'catch', 'finally', 'lock', 'yield', 'when', 'checked', 'unchecked']
const LINQ = ['from', 'where', 'select', 'group', 'by', 'join', 'into', 'orderby', 'ascending', 'descending', 'let', 'on', 'equals', 'distinct']
const TYPES = ['bool', 'byte', 'sbyte', 'char', 'decimal', 'double', 'float', 'int', 'uint', 'long', 'ulong', 'short', 'ushort', 'string', 'object', 'void', 'dynamic', 'var']
const DECL = ['using', 'namespace', 'class', 'interface', 'struct', 'enum', 'public', 'private', 'protected', 'internal', 'static', 'abstract', 'sealed', 'virtual', 'override', 'readonly', 'const', 'new', 'async', 'await', 'this', 'base', 'null', 'true', 'false', 'typeof', 'nameof', 'sizeof', 'default', 'params', 'ref', 'out', 'is', 'as', 'delegate', 'event', 'partial', 'unsafe', 'fixed', 'stackalloc', 'implicit', 'explicit', 'operator', 'extern', 'alias', 'assembly', 'field', 'method', 'param', 'get', 'set', 'add', 'remove', 'volatile']

function kwRules(color: string): editor.ITokenThemeRule[] {
  return CONTROL_FLOW.map(w => ({ token: `keyword.${w}`, foreground: color }))
}
function linqRules(color: string): editor.ITokenThemeRule[] {
  return LINQ.map(w => ({ token: `keyword.${w}`, foreground: color }))
}
function typeRules(color: string): editor.ITokenThemeRule[] {
  return TYPES.map(w => ({ token: `keyword.${w}`, foreground: color }))
}
function declRules(color: string): editor.ITokenThemeRule[] {
  return DECL.map(w => ({ token: `keyword.${w}`, foreground: color }))
}

function buildDarkRules(c: ThemeColorConfig): editor.ITokenThemeRule[] {
  return [
    { token: 'keyword', foreground: c.keyword },
    ...kwRules(c.controlFlow),
    ...linqRules(c.linq),
    ...typeRules(c.type),
    ...declRules(c.keyword),
    { token: 'identifier.method', foreground: c.method },
    { token: 'identifier.class', foreground: c.staticClass },
    { token: 'identifier', foreground: c.identifier },
    { token: 'namespace', foreground: c.namespace },
    { token: 'number', foreground: c.number },
    { token: 'number.float', foreground: c.number },
    { token: 'number.hex', foreground: c.number },
    { token: 'string', foreground: c.string },
    { token: 'string.quote', foreground: c.string },
    { token: 'string.escape', foreground: c.number },
    { token: 'comment', foreground: c.comment },
    { token: 'delimiter', foreground: c.delimiter },
    { token: 'delimiter.curly', foreground: c.keyword },
    { token: 'delimiter.square', foreground: c.keyword },
    { token: 'delimiter.parenthesis', foreground: c.identifier },
    { token: 'delimiter.angle', foreground: c.identifier },
    { token: 'namespace.cpp', foreground: c.namespace },
    { token: 'directive.csx', foreground: c.namespace },
  ]
}

function buildLightRules(c: ThemeColorConfig): editor.ITokenThemeRule[] {
  return [
    { token: 'keyword', foreground: c.keyword },
    ...kwRules(c.controlFlow),
    ...linqRules(c.linq),
    ...typeRules(c.type),
    ...declRules(c.keyword),
    { token: 'identifier.method', foreground: c.method },
    { token: 'identifier.class', foreground: c.staticClass },
    { token: 'identifier', foreground: c.identifier },
    { token: 'namespace', foreground: c.namespace },
    { token: 'number', foreground: c.number },
    { token: 'number.float', foreground: c.number },
    { token: 'number.hex', foreground: c.number },
    { token: 'string', foreground: c.string },
    { token: 'string.quote', foreground: c.string },
    { token: 'string.escape', foreground: c.number },
    { token: 'comment', foreground: c.comment },
    { token: 'delimiter', foreground: c.delimiter },
    { token: 'delimiter.curly', foreground: c.keyword },
    { token: 'delimiter.square', foreground: c.keyword },
    { token: 'delimiter.parenthesis', foreground: c.identifier },
    { token: 'delimiter.angle', foreground: c.identifier },
    { token: 'namespace.cpp', foreground: c.namespace },
    { token: 'directive.csx', foreground: c.namespace },
  ]
}

export function defineThemes(monaco: typeof import('monaco-editor'), colors: { dark: ThemeColorConfig; light: ThemeColorConfig }) {  monaco.editor.defineTheme(THEME_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: buildDarkRules(colors.dark),
    colors: {
      'editor.background': '#0a0a0a',
      'editor.foreground': colors.dark.identifier,
      'editor.lineHighlightBackground': '#101010',
      'editorCursor.foreground': '#00ffff',
      'editor.selectionBackground': '#0f3460',
      'editor.inactiveSelectionBackground': '#0d2540',
      'editor.selectionHighlightBackground': '#0f3460',
      'editor.wordHighlightBackground': '#0f3460',
      'editor.wordHighlightStrongBackground': '#0f3460',
      'editorBracketMatch.background': '#0f3460',
      'editorBracketMatch.border': '#00ffff',
      'editorGutter.background': '#000000',
      'editorGutter.lineNumberForeground': '#666677',
      'editorGutter.lineNumberActiveForeground': '#00ffff',
      'editorError.foreground': '#ff5566',
      'editorWarning.foreground': '#ffbb00',
      'editorInfo.foreground': '#44bbff',
      'editorWhitespace.foreground': '#1a1a1a',
      'editorIndentGuide.background1': '#1a1a1a',
      'editorIndentGuide.activeBackground1': '#00ffff',
      'editorBracketPairColorization.activeColor1': '#00ffff',
      'editorBracketPairColorization.activeColor2': '#aa55ff',
      'editorBracketPairColorization.activeColor3': colors.dark.controlFlow,
      'editorBracketPairColorization.activeColor4': colors.dark.type,
      'editorBracketPairColorization.activeColor5': colors.dark.namespace,
      'editorBracketPairColorization.activeColor6': colors.dark.keyword,
      'editorBracketPairColorization.activeColor7': '#ffa657',
      'editorBracketPairColorization.activeColor8': '#dcdcaa',
      'editorBracketPairColorization.activeColor9': '#00ff77',
      'editorBracketPairColorization.activeColor10': '#44bbff',
      'editorBracketPairColorization.activeColor11': '#ffbb00',
      'editorBracketPairColorization.activeColor12': '#ff5566',
      'stickyScroll.background': '#000000',
      'editorOverviewRuler.background': '#000000',
      'editorRuler.foreground': '#1a1a1a',
      'minimap.background': '#050505',
      'minimap.selectionHighlight': '#00ffff',
      'minimap.findMatchHighlight': '#ffbb00',
      'minimap.errorHighlight': '#ff5566',
      'minimap.warningHighlight': '#ffbb00',
      'editorLink.activeForeground': '#00ffff',
      'editorMarkerNavigation.background': '#000000',
      'editorHoverWidget.background': '#0a0a0a',
      'editorHoverWidget.border': '#1a1a1a',
      'editorSuggestWidget.background': '#0a0a0a',
      'editorSuggestWidget.border': '#1a1a1a',
      'editorSuggestWidget.selectedBackground': '#0f3460',
      'editorWidget.background': '#0a0a0a',
      'editorWidget.border': '#1a1a1a',
      'editorInlineHint.foreground': '#666677',
      'editorGhostText.foreground': '#666677',
      'editorGhostText.border': '#1a1a1a',
    }
  })

  monaco.editor.defineTheme(THEME_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: buildLightRules(colors.light),
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': colors.light.identifier,
      'editor.lineHighlightBackground': '#f5f6f8',
      'editorCursor.foreground': '#0055dd',
      'editor.selectionBackground': '#add6ff',
      'editor.inactiveSelectionBackground': '#e5ebf1',
      'editorGutter.background': '#ffffff',
      'editorGutter.lineNumberForeground': '#8899aa',
      'editorGutter.lineNumberActiveForeground': '#0055dd',
      'editorError.foreground': '#cc2244',
      'editorWarning.foreground': '#bb7700',
      'editorInfo.foreground': '#0088cc',
      'editorWhitespace.foreground': '#dde1e7',
      'editorIndentGuide.background1': '#dde1e7',
      'editorIndentGuide.activeBackground1': '#0055dd',
      'stickyScroll.background': '#ffffff',
      'editorOverviewRuler.background': '#ffffff',
      'minimap.background': '#f5f6f8',
    }
  })
}

let csharpPatchPromise: Promise<void> | null = null

export function patchCSharpGrammar(monaco: typeof import('monaco-editor')) {
  if (csharpPatchPromise) return
  csharpPatchPromise = new Promise<void>((resolve) => {
    const doPatch = async () => {
      try {
        // @ts-ignore - deep import without type declarations
        const mod = await import('monaco-editor/languages/definitions/csharp/csharp')
        // Mutate the SHARED module object (NOT a clone): Monaco's own lazy loader
        // imports the same module and calls setMonarchTokensProvider with it, so
        // even if it runs after us, it will use the patched tokenizer.
        const lang = mod.language as any
        const tok = lang.tokenizer

        const methodRule: any[] = [
          /[a-zA-Z_][\w]*\s*\(/,
          {
            cases: {
              '@keywords': { token: 'keyword.$0', next: '@qualified' },
              '@default': { token: 'identifier.method' }
            }
          }
        ]
        const classRule: any[] = [
          /\@?[A-Z][\w]*\s*\./,
          { token: 'identifier.class', next: '@qualified' }
        ]

        if (Array.isArray(tok.root)) tok.root = [classRule, methodRule, ...tok.root]
        if (Array.isArray(tok.qualified)) tok.qualified = [methodRule, ...tok.qualified]

        monaco.languages.setMonarchTokensProvider('csharp', lang)
      } catch (e) {
        console.error('[monaco-theme] csharp grammar patch failed:', e)
      }
      resolve()
    }

    const registered = monaco.languages.getLanguages().some((l: { id: string }) => l.id === 'csharp')
    if (registered) {
      void doPatch()
    } else {
      monaco.languages.onLanguage('csharp', () => void doPatch())
    }
  })
}
