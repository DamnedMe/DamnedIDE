// Self-check for the "reveal a line once the editor can show it" wait.
// Run: node --experimental-strip-types scripts/reveal-line.check.ts
import assert from 'node:assert/strict'
import { whenLineCanBeShown } from '../src/components/editor/revealLine.ts'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** A Monaco editor reduced to what the wait reads. */
function fakeEditor(opts: { visible: [number, number] | null; lines: number; length?: number }) {
  const state = { ...opts, listeners: new Set<(e: { source: string }) => void>() }
  return {
    state,
    move(source: string) { for (const l of state.listeners) l({ source }) },
    getVisibleRanges: () => (state.visible ? [{ startLineNumber: state.visible[0], endLineNumber: state.visible[1] }] : []),
    getModel: () => ({ getLineCount: () => state.lines, getValueLength: () => state.length ?? state.lines * 10 }),
    onDidChangeCursorPosition(l: (e: { source: string }) => void) {
      state.listeners.add(l)
      return { dispose: () => state.listeners.delete(l) }
    }
  }
}
const run = (e: ReturnType<typeof fakeEditor>, line: number, maxTries = 40) => {
  let revealed = 0
  whenLineCanBeShown(e as never, line, () => { revealed++ }, maxTries)
  return () => revealed
}

// a long file with a real viewport: at once
{
  const e = fakeEditor({ visible: [1, 30], lines: 200 })
  const revealed = run(e, 50)
  assert.equal(revealed(), 1, 'viewport and model ready: revealed at once')
  assert.equal(e.state.listeners.size, 0, 'nothing left subscribed')
}

// a file shorter than a viewport is ready as soon as all of it shows (it used to wait for 5 visible lines)
{
  const e = fakeEditor({ visible: [1, 4], lines: 4 })
  assert.equal(run(e, 1)(), 1, 'a 4-line file fully visible is ready')
}

// the viewport collapsed at open: waits until it is real
{
  const e = fakeEditor({ visible: [1, 1], lines: 200 })
  const revealed = run(e, 50)
  assert.equal(revealed(), 0, 'collapsed viewport: not yet')
  e.state.visible = [1, 30]
  await sleep(100)
  assert.equal(revealed(), 1, 'the viewport became real')
}

// the model still empty (content being read): waits, even if the viewport "shows everything"
{
  const e = fakeEditor({ visible: [1, 1], lines: 1, length: 0 })
  const revealed = run(e, 1)
  assert.equal(revealed(), 0, 'empty model: the content is still being read')
  e.state.lines = 20
  e.state.length = 200
  e.state.visible = [1, 20]
  await sleep(100)
  assert.equal(revealed(), 1, 'content arrived')
}

// the target line beyond the model: waits for it
{
  const e = fakeEditor({ visible: [1, 30], lines: 30 })
  const revealed = run(e, 100)
  assert.equal(revealed(), 0, 'line 100 of a 30-line model: not yet')
  e.state.lines = 200
  await sleep(100)
  assert.equal(revealed(), 1)
}

// THE BUG: the user started working while the wait was pending: their cursor is never moved
for (const source of ['keyboard', 'mouse']) {
  const e = fakeEditor({ visible: [1, 1], lines: 200 })
  const revealed = run(e, 50)
  e.move(source)
  e.state.visible = [1, 30]
  await sleep(100)
  assert.equal(revealed(), 0, `a ${source} move cancels the reveal`)
  assert.equal(e.state.listeners.size, 0, 'nothing left subscribed after a cancel')
}

// programmatic moves (the file content being loaded) do not cancel it
for (const source of ['api', 'modelChange', '']) {
  const e = fakeEditor({ visible: [1, 1], lines: 200 })
  const revealed = run(e, 50)
  e.move(source)
  e.state.visible = [1, 30]
  await sleep(100)
  assert.equal(revealed(), 1, `a "${source}" move is not the user`)
}

// never ready: gives up after maxTries and reveals anyway, as a last attempt
{
  const e = fakeEditor({ visible: [1, 1], lines: 200 })
  const revealed = run(e, 50, 2)
  await sleep(300)
  assert.equal(revealed(), 1, 'revealed after maxTries')
  assert.equal(e.state.listeners.size, 0, 'nothing left subscribed')
}

// the editor disposed while waiting: the wait just ends
{
  const e = fakeEditor({ visible: [1, 1], lines: 200 })
  const revealed = run(e, 50)
  e.getVisibleRanges = () => { throw new Error('disposed') }
  await sleep(100)
  assert.equal(revealed(), 0)
  assert.equal(e.state.listeners.size, 0, 'nothing left subscribed')
}
console.log('ok — reveal-line')
