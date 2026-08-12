import {
  File, FileCode, FileJson, FileText, FileType, Image, FileArchive, Database,
  Braces, FileTerminal, FileCog, Table2, FileCode2, FileVideo, Globe, Boxes
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// Coherent file-type icon + color by extension, used in the editor tabs,
// file explorer and file lists.
const FILE_ICONS: Record<string, { Icon: LucideIcon; color: string }> = {
  ts: { Icon: FileCode, color: 'var(--accent-color)' },
  tsx: { Icon: FileCode, color: 'var(--accent-color)' },
  js: { Icon: FileCode, color: '#e8d44d' },
  jsx: { Icon: FileCode, color: '#e8d44d' },
  cs: { Icon: Braces, color: '#a78bfa' },
  csproj: { Icon: Boxes, color: '#a78bfa' },
  sln: { Icon: Boxes, color: '#a78bfa' },
  slnx: { Icon: Boxes, color: '#a78bfa' },
  sql: { Icon: Database, color: 'var(--warning-color)' },
  json: { Icon: FileJson, color: '#e8d44d' },
  md: { Icon: FileText, color: 'var(--text-secondary)' },
  txt: { Icon: FileText, color: 'var(--text-muted)' },
  log: { Icon: FileText, color: 'var(--text-muted)' },
  css: { Icon: FileType, color: '#61afef' },
  scss: { Icon: FileType, color: '#c678dd' },
  less: { Icon: FileType, color: '#61afef' },
  html: { Icon: Globe, color: '#e06c75' },
  htm: { Icon: Globe, color: '#e06c75' },
  xml: { Icon: FileCode2, color: '#e8d44d' },
  yml: { Icon: FileCog, color: '#98c379' },
  yaml: { Icon: FileCog, color: '#98c379' },
  py: { Icon: FileCode, color: '#61afef' },
  rs: { Icon: FileCode, color: '#d19a66' },
  go: { Icon: FileCode, color: '#61afef' },
  java: { Icon: FileCode, color: '#e06c75' },
  sh: { Icon: FileTerminal, color: '#98c379' },
  bash: { Icon: FileTerminal, color: '#98c379' },
  ps1: { Icon: FileTerminal, color: '#61afef' },
  bat: { Icon: FileTerminal, color: '#e8d44d' },
  cmd: { Icon: FileTerminal, color: '#e8d44d' },
  dockerfile: { Icon: FileCog, color: '#61afef' },
  ini: { Icon: FileCog, color: 'var(--text-muted)' },
  env: { Icon: FileCog, color: 'var(--text-muted)' },
  png: { Icon: Image, color: '#c678dd' },
  jpg: { Icon: Image, color: '#c678dd' },
  jpeg: { Icon: Image, color: '#c678dd' },
  gif: { Icon: Image, color: '#c678dd' },
  svg: { Icon: Image, color: '#c678dd' },
  webp: { Icon: Image, color: '#c678dd' },
  ico: { Icon: Image, color: '#c678dd' },
  mp4: { Icon: FileVideo, color: '#e06c75' },
  webm: { Icon: FileVideo, color: '#e06c75' },
  mp3: { Icon: FileText, color: '#e06c75' },
  zip: { Icon: FileArchive, color: '#e8d44d' },
  tar: { Icon: FileArchive, color: '#e8d44d' },
  gz: { Icon: FileArchive, color: '#e8d44d' },
  pdf: { Icon: FileText, color: '#e06c75' },
  docx: { Icon: FileText, color: '#61afef' },
  xlsx: { Icon: Table2, color: '#98c379' },
  csv: { Icon: Table2, color: '#98c379' },
  cshtml: { Icon: Globe, color: '#e06c75' }
}

export function fileIconFor(filePath: string): { Icon: LucideIcon; color: string } {
  const base = filePath.split(/[/\\]/).pop() || filePath
  const ext = base.toLowerCase().endsWith('.gitignore') ? 'gitignore'
    : base.toLowerCase() === 'dockerfile' ? 'dockerfile'
    : (base.split('.').pop() || '').toLowerCase()
  return FILE_ICONS[ext] || { Icon: File, color: 'var(--text-muted)' }
}

export function FileTypeIcon({ path, size = 13, style }: {
  path: string
  size?: number
  style?: React.CSSProperties
}) {
  const { Icon, color } = fileIconFor(path)
  return <Icon size={size} style={{ color, flexShrink: 0, ...style }} />
}
