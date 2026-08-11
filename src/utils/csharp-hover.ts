// Monaco hover provider for C#: signature + XML doc summary (VS-style). Works in the
// main editor, the worktree edit editor and the diff viewers. The file path is resolved
// through a model→file registry because diff models have no real path.

const modelFileMap = new Map<string, string>()
let registered = false

export function registerCSharpHover(monaco: any): void {
  if (registered) return
  registered = true
  monaco.languages.registerHoverProvider('csharp', {
    async provideHover(model: any, position: any) {
      const file = modelFileMap.get(model.uri.toString())
      if (!file?.toLowerCase().endsWith('.cs')) return null
      try {
        const text = model.getValue()
        const r = await window.electronAPI.roslyn.hover(file, position.lineNumber, position.column, text)
        if (!r || (!r.signature && !r.summary)) return null
        const parts: string[] = []
        if (r.signature) parts.push(`\`${r.signature}\``)
        if (r.summary) parts.push(r.summary)
        const word = model.getWordAtPosition(position)
        return {
          contents: [{ value: parts.join('\n\n') }],
          range: word
            ? new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
            : undefined
        }
      } catch {
        return null
      }
    }
  })
}

// Associates a Monaco model (by uri) with its on-disk file path for hover resolution.
// Returns a disposer to unregister when the model is disposed.
export function trackHoverModel(model: any, filePath: string | null): () => void {
  if (!model || !filePath) return () => {}
  const key = model.uri.toString()
  modelFileMap.set(key, filePath)
  const d = model.onWillDispose?.(() => { modelFileMap.delete(key) })
  return () => { d?.dispose(); modelFileMap.delete(key) }
}
