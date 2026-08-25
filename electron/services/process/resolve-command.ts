import { existsSync } from 'fs'
import { delimiter, join } from 'path'

const cache = new Map<string, string>()

// On Windows `claude`, `codex`, `npx`… are `.cmd` shims: since Node 18.20 spawn()
// refuses to run them without an extension, and `shell: true` would break any
// argument containing spaces. Resolve the real file through PATH × PATHEXT once
// and spawn it directly.
export function resolveCommand(command: string): string {
  if (process.platform !== 'win32') return command
  if (/[\\/]/.test(command) || /\.\w+$/.test(command)) return command
  const hit = cache.get(command)
  if (hit) return hit
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const full = join(dir, command + ext)
      if (existsSync(full)) {
        cache.set(command, full)
        return full
      }
    }
  }
  return command
}
