// Self-check for the DamnedCloud remote protocol helpers.
// Run: node --experimental-strip-types scripts/remote-protocol.check.ts
import assert from 'node:assert/strict'
import {
  PROTOCOL_VERSION,
  DEEP_LINK_SCHEME,
  toBase64Url,
  fromBase64Url,
  isEnvelope
} from '../src/shared/remote/protocol.ts'

// base64url round-trip (ascii, accents, uri-significant chars, JSON, emoji)
const samples = ['', 'hello', 'àèìòù', 'a/b+c=d', '{"v":1,"host":"pc.tailnet.ts.net","port":8765}', '😀']
for (const value of samples) {
  assert.equal(fromBase64Url(toBase64Url(value)), value, `round-trip: ${value}`)
}

// the encoding must be url-safe (no +/=)
assert.ok(!/[+/=]/.test(toBase64Url('???>>>///+++')), 'output is url-safe')

// envelope validation
assert.ok(isEnvelope({ v: PROTOCOL_VERSION, id: 'r1', kind: 'req', cmd: 'system.ping' }))
assert.ok(isEnvelope({ v: PROTOCOL_VERSION, id: 'r1', kind: 'res', ok: true }))
assert.ok(isEnvelope({ v: PROTOCOL_VERSION, kind: 'evt', topic: 'fs.changed', data: {} }))
assert.ok(!isEnvelope({ v: PROTOCOL_VERSION + 1, id: 'r1', kind: 'req', cmd: 'x' }), 'version mismatch rejected')
assert.ok(!isEnvelope({ kind: 'req' }), 'missing version/id rejected')
assert.ok(!isEnvelope(null), 'null rejected')

assert.equal(DEEP_LINK_SCHEME, 'damnedcloud')

console.log('ok — remote protocol')
