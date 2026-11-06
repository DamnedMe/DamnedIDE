// Type imports only: scripts/reveal-line.check.ts runs this with plain node and a fake editor.
import type { editor as monacoEditor } from 'monaco-editor'

const RETRY_MS = 60

/** The bits of a Monaco editor the wait reads. */
type RevealTarget = Pick<monacoEditor.ICodeEditor, 'getVisibleRanges' | 'getModel' | 'onDidChangeCursorPosition'>

/**
 * Runs `reveal` once `editor` can really show `line`: at open the viewport can be collapsed
 * to ~1 line and the model still empty, and a reveal then is a no-op (the file lands at the
 * top). After `maxTries` retries it runs anyway, as a last attempt.
 *
 * It never runs after the user has started working in the editor: `reveal` moves the cursor,
 * and what they type would land there.
 */
export function whenLineCanBeShown(editor: RevealTarget, line: number, reveal: () => void, maxTries = 40): void {
  let tries = 0
  let userMoved = false
  const moves = editor.onDidChangeCursorPosition((e) => {
    if (e.source === 'keyboard' || e.source === 'mouse') userMoved = true
  })
  const attempt = () => {
    try {
      if (userMoved) {
        moves.dispose()
        return
      }
      const visible = editor.getVisibleRanges()?.[0]
      const model = editor.getModel()
      const lines = model?.getLineCount() ?? 0
      // at least 5 visible lines, or a file short enough to show entirely
      const viewReady = !!visible && (visible.endLineNumber - visible.startLineNumber >= 4 || visible.endLineNumber >= lines)
      const modelReady = lines >= line && (model?.getValueLength() ?? 0) > 0
      if ((viewReady && modelReady) || tries > maxTries) {
        moves.dispose()
        reveal()
      } else {
        tries++
        setTimeout(attempt, RETRY_MS)
      }
    } catch {
      // the editor went away while waiting
      moves.dispose()
    }
  }
  attempt()
}
