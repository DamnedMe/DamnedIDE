import { statSync } from 'fs'
import { normalize } from 'path'

export interface OpenTarget {
  path: string
  isDirectory: boolean
}

/** Path handed over by the OS or the CLI, resolved to a folder/file target. */
export function resolveOpenTarget(candidate: string): OpenTarget | null {
  try {
    const p = normalize(candidate)
    return { path: p, isDirectory: statSync(p).isDirectory() }
  } catch {
    return null
  }
}

interface ArgvOptions {
  // false in dev: electron-vite passes its own paths, which must not be opened
  packaged: boolean
  appPath: string
}

/**
 * Extracts the path to open from a process argv. Explorer passes the shell verb
 * argument as %1; `--open <path>` is supported explicitly (also in dev).
 */
export function openTargetFromArgv(argv: string[], opts: ArgvOptions): OpenTarget | null {
  const flag = argv.indexOf('--open')
  if (flag >= 0 && argv[flag + 1]) return resolveOpenTarget(argv[flag + 1])
  if (!opts.packaged) return null
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue
    if (normalize(arg) === normalize(opts.appPath)) continue
    const target = resolveOpenTarget(arg)
    if (target) return target
  }
  return null
}
