// Applies Roslyn compiler diagnostics as Monaco markers on an editor (main editor and
// worktree edit editor share this helper). Returns error/warning counts.

export interface CSharpDiagnostic {
  code?: string
  severity: string
  message: string
  line: number
  column: number
  endLine: number
  endColumn: number
}

export interface DiagnosticCounts {
  errors: number
  warnings: number
}

export async function applyCSharpDiagnostics(
  editor: any,
  monaco: any,
  filePath: string | null
): Promise<DiagnosticCounts> {
  const model = editor?.getModel?.()
  if (!model || !monaco) return { errors: 0, warnings: 0 }
  if (!filePath?.toLowerCase().endsWith('.cs')) {
    monaco.editor.setModelMarkers(model, 'damnedide', [])
    return { errors: 0, warnings: 0 }
  }
  try {
    const text = model.getValue()
    const r = await window.electronAPI.roslyn.diagnostics(filePath, text)
    let errors = 0
    let warnings = 0
    const markers: any[] = []
    for (const d of r?.diagnostics || []) {
      if (d.severity === 'error') errors++
      else if (d.severity === 'warning') warnings++
      else continue
      markers.push({
        severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: `${d.code ? `[${d.code}] ` : ''}${d.message}`,
        startLineNumber: d.line,
        startColumn: d.column,
        endLineNumber: d.endLine || d.line,
        endColumn: d.endColumn || d.column + 1
      })
    }
    monaco.editor.setModelMarkers(model, 'damnedide', markers)
    return { errors, warnings }
  } catch {
    monaco.editor.setModelMarkers(model, 'damnedide', [])
    return { errors: 0, warnings: 0 }
  }
}

export function clearCSharpDiagnostics(editor: any, monaco: any): void {
  const model = editor?.getModel?.()
  if (model && monaco) monaco.editor.setModelMarkers(model, 'damnedide', [])
}

const timers = new WeakMap<object, ReturnType<typeof setTimeout>>()

// Debounced re-check (used on content changes); typing stops → check after `delayMs`.
export function scheduleCSharpDiagnostics(
  editor: any,
  monaco: any,
  filePath: string | null,
  delayMs = 700,
  onCounts?: (c: DiagnosticCounts) => void
): void {
  if (!editor || !monaco) return
  const existing = timers.get(editor)
  if (existing) clearTimeout(existing)
  timers.set(editor, setTimeout(async () => {
    timers.delete(editor)
    const c = await applyCSharpDiagnostics(editor, monaco, filePath)
    onCounts?.(c)
  }, delayMs))
}
