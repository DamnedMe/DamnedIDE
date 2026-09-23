import { execFile } from 'child_process'
import { realpathSync } from 'fs'

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

// Node can hand out 8.3 short paths (C:\Users\DAMIAN~1\...) while Explorer
// reports the long canonical path: resolve before comparing.
function canonicalPath(targetPath: string): string {
  try {
    return realpathSync.native(targetPath)
  } catch {
    return targetPath
  }
}

/**
 * Closes the Explorer windows showing `targetPath` (or a subfolder of it).
 *
 * Windows Explorer keeps a handle on the folder it displays, and that handle is
 * enough to make the recursive delete of a worktree fail with EBUSY/EPERM.
 * Closing the window releases it. No admin rights, no Explorer restart.
 * Resolves with the number of closed windows (0 on non-Windows or on failure).
 */
export function closeExplorerWindowsAt(targetPath: string): Promise<number> {
  if (process.platform !== 'win32') return Promise.resolve(0)

  const target = canonicalPath(targetPath)
  const script = `
$target = ${psQuote(target)}.TrimEnd([char]92)
$closed = 0
try {
  $shell = New-Object -ComObject Shell.Application
  foreach ($w in @($shell.Windows())) {
    try {
      if (-not $w.LocationURL) { continue }
      $p = ([System.Uri]$w.LocationURL).LocalPath.TrimEnd([char]92)
      $same = $p -ieq $target
      $under = $p.StartsWith($target + [char]92, [System.StringComparison]::OrdinalIgnoreCase)
      if ($same -or $under) { $w.Quit(); $closed++ }
    } catch { }
  }
} catch { }
Write-Output $closed
`

  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 20000 },
      (_err, stdout) => {
        const n = parseInt(String(stdout).trim(), 10)
        resolve(Number.isFinite(n) ? n : 0)
      })
  })
}
