// Updater log: userData/logs/updater.log, one ISO-timestamped line per message
// (pid included: several IDE instances share the file). electron-updater's own
// logger is routed here too, so "detected, maybe installed, still the old
// version" can be told apart afterwards. Past `maxBytes` the file rolls over to
// updater.old.log. No electron import: node checks exercise it directly.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'

export interface UpdateLog {
  readonly path: string
  info(message?: unknown): void
  warn(message?: unknown): void
  error(message?: unknown): void
  debug(message?: unknown): void
}

export const MAX_UPDATE_LOG_BYTES = 1024 * 1024

function text(message: unknown): string {
  if (typeof message === 'string') return message
  if (message instanceof Error) return message.stack || message.message
  try { return JSON.stringify(message) } catch { return String(message) }
}

/** Every line of a (possibly multi-line) message gets the timestamp, pid and level. */
export function formatLogLines(level: string, message: unknown, now = new Date(), pid = process.pid): string {
  const prefix = `${now.toISOString()} [${pid}] ${level.toUpperCase()}`
  return text(message).split(/\r?\n/).map(line => `${prefix} ${line}\n`).join('')
}

export function oldLogPath(file: string): string {
  return join(dirname(file), `${basename(file, '.log')}.old.log`)
}

export function createUpdateLog(file: string, maxBytes = MAX_UPDATE_LOG_BYTES): UpdateLog {
  const write = (level: string, message: unknown) => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      try {
        if (statSync(file).size > maxBytes) renameSync(file, oldLogPath(file))
      } catch { /* no log yet, or another instance rolled it first */ }
      appendFileSync(file, formatLogLines(level, message))
    } catch { /* logging never breaks the updater */ }
  }
  return {
    path: file,
    info: (m) => write('info', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
    debug: (m) => write('debug', m)
  }
}
