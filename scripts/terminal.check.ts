// Self-check for the terminal font stack and the terminal zoom helpers.
// Run: node --experimental-strip-types scripts/terminal.check.ts
import assert from 'node:assert/strict'
import { APP_FONT_CHOICES, MONO_FALLBACK, TERMINAL_FONT_STACK, appFontStack } from '../src/utils/fonts.ts'
import {
  TERMINAL_FONT_DEFAULT, TERMINAL_FONT_MAX, TERMINAL_FONT_MIN,
  nextTerminalFontSize, terminalZoomKey
} from '../src/components/terminal/terminal-zoom.ts'

// --- font stack: xterm needs a fixed-pitch family (proportional = gaps between letters)
assert.ok(TERMINAL_FONT_STACK.trim().endsWith('monospace'), 'terminal stack ends with the generic monospace')
const proportional = APP_FONT_CHOICES.map(c => c.value).filter(v => v !== 'JetBrains Mono')
for (const family of proportional) {
  assert.ok(!TERMINAL_FONT_STACK.includes(family), `terminal stack has no proportional family (${family})`)
}
assert.ok(appFontStack('Nunito').startsWith("'Nunito'"), 'the UI stack still starts with the app font')
assert.equal(appFontStack('Nunito'), `'Nunito', ${MONO_FALLBACK}`, 'the UI stack is unchanged')

// --- zoom keys
const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = { ctrlKey: true }) =>
  terminalZoomKey({ ctrlKey: false, metaKey: false, altKey: false, ...mods, key })
for (const key of ['+', '=', 'Add']) assert.equal(k(key), 'in', `Ctrl+${key} zooms in`)
for (const key of ['-', 'Subtract']) assert.equal(k(key), 'out', `Ctrl+${key} zooms out`)
assert.equal(k('0'), 'reset', 'Ctrl+0 resets')
assert.equal(k('=', { metaKey: true }), 'in', 'Cmd works like Ctrl')
assert.equal(k('=', {}), null, 'no modifier: not a zoom')
assert.equal(k('0', {}), null, 'plain 0 is typed')
assert.equal(k('+', { ctrlKey: true, altKey: true }), null, 'AltGr (Ctrl+Alt) is not a zoom')
assert.equal(k('_', { ctrlKey: true }), null, 'Ctrl+Shift+- (readline undo) is left to the shell')
assert.equal(k('c'), null, 'Ctrl+C stays SIGINT')

// --- font size steps
assert.equal(TERMINAL_FONT_DEFAULT, 12)
assert.equal(nextTerminalFontSize(12, 'in'), 13)
assert.equal(nextTerminalFontSize(12, 'out'), 11)
assert.equal(nextTerminalFontSize(20, 'reset'), 12, 'reset returns the default')
assert.equal(nextTerminalFontSize(TERMINAL_FONT_MAX, 'in'), 32, 'clamped at 32')
assert.equal(nextTerminalFontSize(TERMINAL_FONT_MIN, 'out'), 8, 'clamped at 8')
assert.equal(nextTerminalFontSize(100, 'out'), 32, 'an out-of-range stored value is pulled back in range')
assert.equal(nextTerminalFontSize(12.6, 'in'), 14, 'fractional values snap to whole px')

console.log('ok — terminal')
