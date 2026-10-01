// Pure helpers for the database backup / data-tier features (no electron deps).

export interface BackupOptions {
  /** path on the SQL Server machine (BACKUP writes server-side) */
  path: string
  compress: boolean
  copyOnly: boolean
  /** overwrite an existing file (INIT) */
  init: boolean
}

export type DataTierAction = 'extract' | 'export' | 'import'

export type BackupSource = 'bak' | 'bacpac'

/** One logical file inside a .bak (RESTORE FILELISTONLY). */
export interface BackupFileInfo {
  logicalName: string
  type: string
}

export interface RestoreOptions {
  database: string
  /** server-side path of the .bak */
  path: string
  files: BackupFileInfo[]
  dataDirectory: string
  logDirectory: string
  /** overwrite an existing database (REPLACE) */
  replace: boolean
}

function sqlString(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`
}

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

/** SqlPackage arguments for the chosen data-tier action. Import reads a local
 *  .bacpac and creates/updates the target database through its connection. */
export function dataTierArgs(action: DataTierAction, connectionString: string, file: string, targetDatabase?: string): string[] {
  if (action === 'import') {
    const args = ['/Action:Import', `/SourceFile:${file}`, `/TargetConnectionString:${connectionString}`]
    if (targetDatabase) args.push(`/TargetDatabaseName:${targetDatabase}`)
    return args
  }
  return [
    `/Action:${action === 'extract' ? 'Extract' : 'Export'}`,
    `/SourceConnectionString:${connectionString}`,
    `/TargetFile:${file}`,
    '/p:VerifyExtraction=True'
  ]
}

/** Logical files and their types inside a .bak. */
export function buildFileListStatement(path: string): string {
  return `RESTORE FILELISTONLY FROM DISK = ${sqlString(path)}`
}

/**
 * T-SQL RESTORE for a .bak. Every logical file is moved next to the instance
 * defaults (or the original directories when the server does not report them),
 * so a backup taken on another machine still restores here.
 */
export function buildRestoreStatement(opts: RestoreOptions): string {
  const moves = opts.files.map(file => {
    const isLog = file.type.toUpperCase() === 'L'
    const directory = isLog ? opts.logDirectory : opts.dataDirectory
    const safeName = file.logicalName.replace(/[\\/:*?"<>|]/g, '_')
    const physical = joinServerPath(directory, `${safeName}${isLog ? '.ldf' : '.mdf'}`)
    return `MOVE ${sqlString(file.logicalName)} TO ${sqlString(physical)}`
  })
  const withParts = [...moves, 'RECOVERY', 'STATS = 10']
  if (opts.replace) withParts.push('REPLACE')
  return `RESTORE DATABASE ${quoteIdentifier(opts.database)}\nFROM DISK = ${sqlString(opts.path)}\nWITH ${withParts.join(',\n     ')}`
}

/** Suggested target database name for an import. */
export function suggestedImportDatabaseName(database: string, source: BackupSource): string {
  const suffix = source === 'bak' ? 'restore' : 'import'
  return `${database}_${suffix}`
}
