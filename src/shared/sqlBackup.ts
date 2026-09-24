// Pure helpers for the database backup / data-tier features (no electron deps).

export interface BackupOptions {
  /** path on the SQL Server machine (BACKUP writes server-side) */
  path: string
  compress: boolean
  copyOnly: boolean
  /** overwrite an existing file (INIT) */
  init: boolean
}

export type DataTierAction = 'extract' | 'export'

function quoteIdentifier(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`
}

/** T-SQL BACKUP statement for the options chosen in the dialog. */
export function buildBackupStatement(database: string, opts: BackupOptions): string {
  const withParts = ['STATS = 10']
  if (opts.copyOnly) withParts.push('COPY_ONLY')
  if (opts.compress) withParts.push('COMPRESSION')
  if (opts.init) withParts.push('INIT')
  return `BACKUP DATABASE ${quoteIdentifier(database)}\nTO DISK = N'${opts.path.replace(/'/g, "''")}'\nWITH ${withParts.join(', ')}`
}

function stamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

/** Suggested `.bak` file name (server-side path component). */
export function defaultBackupFileName(database: string, date = new Date()): string {
  return `${database}_${stamp(date)}.bak`
}

/** Suggested `.dacpac`/`.bacpac` file name (local file). */
export function dataTierTargetName(database: string, action: DataTierAction, date = new Date()): string {
  return `${database}_${stamp(date)}.${action === 'extract' ? 'dacpac' : 'bacpac'}`
}

/** Joins a server directory and a file name, keeping the server separator style. */
export function joinServerPath(dir: string, file: string): string {
  const separator = dir.includes('\\') ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${separator}${file}`
}

/** SqlPackage arguments for the chosen data-tier action. */
export function dataTierArgs(action: DataTierAction, connectionString: string, targetFile: string): string[] {
  return [
    `/Action:${action === 'extract' ? 'Extract' : 'Export'}`,
    `/SourceConnectionString:${connectionString}`,
    `/TargetFile:${targetFile}`,
    '/p:VerifyExtraction=True'
  ]
}
