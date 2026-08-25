// Self-check for the `claude -p --output-format stream-json` reducer.
// Run: node --experimental-strip-types scripts/ai-stream-json.check.ts
import assert from 'node:assert/strict'
import { parseCliEvent } from '../electron/services/ai/stream-json.ts'

const SID = '7f0b1c2d-0000-4000-8000-000000000001'

// a real turn: init → text deltas → a tool call → result
const lines = [
  `{"type":"system","subtype":"init","session_id":"${SID}","model":"claude-opus-5"}`,
  `{"type":"stream_event","session_id":"${SID}","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Ciao"}}}`,
  `{"type":"stream_event","session_id":"${SID}","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":" mondo"}}}`,
  `{"type":"assistant","session_id":"${SID}","message":{"content":[{"type":"tool_use","name":"Read","input":{}}]}}`,
  `{"type":"result","subtype":"success","session_id":"${SID}","result":"Ciao mondo","total_cost_usd":0.0123,"usage":{"input_tokens":10,"output_tokens":4,"cache_read_input_tokens":900}}`
]

let text = ''
let session = ''
const tools: string[] = []
let final: { costUsd: number; isError: boolean; usage?: { cacheReadTokens?: number } } | undefined

for (const line of lines) {
  const ev = parseCliEvent(line)
  if (!ev) continue
  if (ev.sessionId) session = ev.sessionId
  if (ev.delta) text += ev.delta
  if (ev.tool) tools.push(ev.tool)
  if (ev.final) final = ev.final
}

assert.equal(text, 'Ciao mondo', 'text deltas must accumulate in order')
assert.equal(session, SID, 'session id must be picked up for --resume')
assert.deepEqual(tools, ['Read'], 'tool calls must surface as activity')
assert.equal(final?.costUsd, 0.0123)
assert.equal(final?.usage?.cacheReadTokens, 900)
assert.equal(final?.isError, false, 'a successful turn must not be flagged as an error')

// an expired login is reported as a result line with is_error: it must not be
// mistaken for an answer (real failure seen from `claude auth status` expiry)
const authFail = parseCliEvent('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Failed to authenticate. API Error: 401","total_cost_usd":0}')
assert.equal(authFail?.final?.isError, true)

// garbage and CLI chatter must not throw or produce phantom events
assert.equal(parseCliEvent(''), null)
assert.equal(parseCliEvent('not json'), null)
assert.deepEqual(parseCliEvent('{"type":"user","message":{"content":[]}}'), {})

// no partial-message deltas (older CLI / --include-partial-messages ignored):
// the final result text is the only content, and must still be delivered
const only = parseCliEvent(`{"type":"result","result":"solo finale","total_cost_usd":0}`)
assert.equal(only?.final?.text, 'solo finale')

console.log('ok — stream-json reducer')
