import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronRight, Folder, FolderOpen, File, Loader2, ChevronsUpDown, ChevronsDownUp, Trash2, FolderPlus, FilePlus, ExternalLink } from 'lucide-react'

interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  children?: TreeNode[]
  isLoading?: boolean
  loaded?: boolean
}

interface FileFilter {
  query: string
  mode: 'startsWith' | 'like' | 'regex'
  caseSensitive: boolean
  spaceSensitive: boolean
}

interface FileTreeProps {
  rootPath: string
  onFileSelect: (filePath: string) => void
  selectedFile?: string | null
  filter?: FileFilter | null
}

interface CachedFileList {
  rootPath: string
  entries: { path: string; name: string }[]
  ts: number
}

const CACHE_TTL = 60_000
const MAX_DISPLAY = 1000

function matchName(name: string, f: FileFilter): boolean {
  const norm = (s: string) => f.spaceSensitive ? s : s.replace(/\s+/g, '')
  const q = norm(f.caseSensitive ? f.query : f.query.toLowerCase())
  const t = norm(f.caseSensitive ? name : name.toLowerCase())
  if (!q) return true
  try {
    switch (f.mode) {
      case 'startsWith': return t.startsWith(q)
      case 'regex': return new RegExp(q).test(t)
      default: return t.includes(q)
    }
  } catch {
    return t.includes(q)
  }
}

export function FileTree({ rootPath, onFileSelect, selectedFile, filter }: FileTreeProps) {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [filteredTree, setFilteredTree] = useState<TreeNode | null>(null)
  const [totalMatches, setTotalMatches] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isFiltering, setIsFiltering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandAllFlag, setExpandAllFlag] = useState(0)
  const fileListRef = useRef<CachedFileList | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null)

  useEffect(() => {
    loadRoot()
  }, [rootPath])

  useEffect(() => {
    if (!filter?.query) {
      setFilteredTree(null)
      return
    }
    let cancelled = false

    const applyFilter = (entries: { path: string; name: string }[]) => {
      if (cancelled) return
      const f = filter
      const matched = entries.filter(e => matchName(e.name, f))
      setTotalMatches(matched.length)
      const shown = matched.slice(0, MAX_DISPLAY)
      setFilteredTree(buildVirtualTree(rootPath, shown.map(e => e.path)))
    }

    const cache = fileListRef.current
    const fresh = cache && cache.rootPath === rootPath && (Date.now() - cache.ts) < CACHE_TTL
    if (fresh) {
      applyFilter(cache.entries)
      return
    }

    setIsFiltering(true)
    window.electronAPI.fs.listFiles(rootPath)
      .then(paths => {
        if (cancelled) return
        const entries = paths.map(p => ({ path: p, name: p.split(/[/\\]/).pop() || p }))
        fileListRef.current = { rootPath, entries, ts: Date.now() }
        setIsFiltering(false)
        applyFilter(entries)
      })
      .catch(e => {
        if (cancelled) return
        setIsFiltering(false)
        setError((e as Error).message)
      })
    return () => { cancelled = true }
  }, [rootPath, filter?.query, filter?.mode, filter?.caseSensitive, filter?.spaceSensitive])

  const lastRevealedRef = useRef<string | null>(null)

  // Ctrl+C copies the selected file's path to the clipboard (works outside the IDE)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return
      const target = document.activeElement as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (!selectedFile) return
      e.preventDefault()
      window.electronAPI.clipboard.write(selectedFile)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedFile])

  useEffect(() => {
    if (!selectedFile || !tree || !!filter?.query) return
    if (lastRevealedRef.current === selectedFile) return
    lastRevealedRef.current = selectedFile
    revealInTree(selectedFile)
  }, [selectedFile, tree, filter?.query])

  const revealInTree = async (targetPath: string) => {
    if (!tree) return
    const rel = targetPath.slice(rootPath.length).replace(/^[/\\]/, '')
    if (!rel) return
    const parts = rel.split(/[/\\]/)
    let node = tree
    if (!node.loaded) {
      const loaded = await buildNode(node.path, node.name)
      node.children = loaded.children
      node.isLoading = false
      node.loaded = true
      setTree({ ...node })
    }
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]
      const child = node.children?.find(c => c.name === seg && c.isDirectory)
      if (!child) break
      if (!child.loaded) {
        child.isLoading = true
        setTree({ ...tree! })
        const loaded = await buildNode(child.path, child.name)
        child.children = loaded.children
        child.isLoading = false
        child.loaded = true
        setTree({ ...tree! })
      }
      node = child
    }
  }

  const refreshNode = async (nodePath: string) => {
    if (!tree) return
    const loaded = await buildNode(nodePath, nodePath.split(/[/\\]/).pop() || nodePath)
    const updateParent = (n: TreeNode): boolean => {
      if (n.path === nodePath) { n.children = loaded.children; n.loaded = true; return true }
      if (n.children) for (const c of n.children) { if (updateParent(c)) return true }
      return false
    }
    if (updateParent(tree)) setTree({ ...tree })
  }

  const handleDelete = async (node: TreeNode) => {
    try {
      await window.electronAPI.fs.delete(node.path)
      const parentPath = node.path.split(/[/\\]/).slice(0, -1).join('\\') || rootPath
      await refreshNode(parentPath)
    } catch { /* ignore */ }
  }

  const handleCreateFile = async (parentNode: TreeNode) => {
    const name = prompt('File name:')
    if (!name) return
    try {
      const newPath = `${parentNode.path}\\${name}`
      await window.electronAPI.fs.writeFile(newPath, '')
      await refreshNode(parentNode.path)
    } catch { /* ignore */ }
  }

  const handleCreateFolder = async (parentNode: TreeNode) => {
    const name = prompt('Folder name:')
    if (!name) return
    try {
      const newPath = `${parentNode.path}\\${name}`
      await window.electronAPI.fs.mkdir(newPath)
      await refreshNode(parentNode.path)
    } catch { /* ignore */ }
  }

  const handleOpenFolder = (node: TreeNode) => {
    const dirPath = node.isDirectory ? node.path : node.path.split(/[/\\]/).slice(0, -1).join('\\')
    window.electronAPI.shell.openFolder(dirPath)
  }

  const loadRoot = async () => {
    setIsLoading(true)
    setError(null)
    setFilteredTree(null)
    fileListRef.current = null
    try {
      const root = await buildNode(rootPath, rootPath.split(/[/\\]/).pop() || rootPath)
      setTree(root)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }

  const buildNode = async (fullPath: string, name: string): Promise<TreeNode> => {
    try {
      const entries = await window.electronAPI.fs.readDir(fullPath)
      const node: TreeNode = {
        name, path: fullPath,
        isDirectory: true, isFile: false,
        children: [], loaded: false
      }
      const dirs: TreeNode[] = []
      const files: TreeNode[] = []
      for (const e of entries) {
        if (e.isDirectory) {
          dirs.push({
            name: e.name, path: `${fullPath}\\${e.name}`,
            isDirectory: true, isFile: false,
            children: [], loaded: false
          })
        } else {
          files.push({
            name: e.name, path: `${fullPath}\\${e.name}`,
            isDirectory: false, isFile: true
          })
        }
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name))
      files.sort((a, b) => a.name.localeCompare(b.name))
      node.children = [...dirs, ...files]
      node.loaded = true
      return node
    } catch {
      return { name, path: fullPath, isDirectory: false, isFile: true }
    }
  }

  const toggleExpand = async (node: TreeNode) => {
    if (filteredTree) return
    if (node.loaded) {
      node.loaded = false
      setTree({ ...tree! })
      return
    }
    node.isLoading = true
    setTree({ ...tree! })
    try {
      const loaded = await buildNode(node.path, node.name)
      const updateNode = (n: TreeNode): boolean => {
        if (n.path === node.path) { n.children = loaded.children; n.isLoading = false; n.loaded = true; return true }
        if (n.children) for (const child of n.children) { if (updateNode(child)) return true }
        return false
      }
      if (tree) updateNode(tree)
      setTree({ ...tree! })
    } catch { node.isLoading = false; setTree({ ...tree! }) }
  }

  const collapseRecursive = useCallback((node: TreeNode) => {
    node.loaded = false
    if (node.children) for (const child of node.children) collapseRecursive(child)
  }, [])

  const handleCollapseAll = () => {
    if (!tree || filteredTree) return
    collapseRecursive(tree)
    setTree({ ...tree })
  }

  const handleExpandAll = async () => {
    if (!tree || filteredTree) return
    setExpandAllFlag(f => f + 1)
    const expand = async (node: TreeNode): Promise<void> => {
      if (!node.isDirectory) return
      if (!node.loaded) {
        node.isLoading = true
        setTree({ ...tree })
        const loaded = await buildNode(node.path, node.name)
        node.children = loaded.children
        node.isLoading = false
        node.loaded = true
      }
      if (node.children) for (const child of node.children) await expand(child)
    }
    await expand(tree)
    setTree({ ...tree })
  }

  if (isLoading) {
    return (
      <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
        <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
        Loading...
      </div>
    )
  }

  if (error) {
    return <div style={{ padding: '12px', color: 'var(--error-color)', fontSize: '11px' }}>{error}</div>
  }

  const displayTree = filteredTree || tree
  if (!displayTree) return null

  return (
    <div style={{ flex: 1, overflow: 'hidden', padding: '4px 0', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', gap: '1px', padding: '2px 6px',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
      }}>
        <ToolbarBtn onClick={handleCollapseAll} title="collapse all" disabled={!!filteredTree}>
          <ChevronsUpDown size={11} />
        </ToolbarBtn>
        <ToolbarBtn onClick={handleExpandAll} title="expand all" disabled={!!filteredTree}>
          <ChevronsDownUp size={11} />
        </ToolbarBtn>
      </div>
      {isFiltering && (
        <div style={{ padding: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '11px' }}>
          <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
          indexing...
        </div>
      )}
      {!isFiltering && filteredTree && (
        <div style={{ padding: '3px 8px', color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {totalMatches === 0
            ? 'no files match'
            : totalMatches > MAX_DISPLAY
              ? `${totalMatches} matches — showing first ${MAX_DISPLAY}`
              : `${totalMatches} match${totalMatches === 1 ? '' : 'es'}`}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <TreeNodeItem
          node={displayTree} depth={0} onToggle={toggleExpand}
          onFileSelect={onFileSelect} selectedFile={selectedFile}
          isRoot expandAllFlag={expandAllFlag} isVirtual={!!filteredTree}
          onContextMenu={(e, node) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, node }) }}
        />
      </div>
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={() => setContextMenu(null)}
          onDelete={handleDelete}
          onNewFile={handleCreateFile}
          onNewFolder={handleCreateFolder}
          onOpenFolder={handleOpenFolder}
        />
      )}
    </div>
  )
}

function buildVirtualTree(rootPath: string, filePaths: string[]): TreeNode {
  const rootName = rootPath.split(/[/\\]/).pop() || rootPath
  const root: TreeNode = {
    name: rootName,
    path: rootPath,
    isDirectory: true,
    isFile: false,
    loaded: true,
    children: []
  }

  const getOrCreateDir = (parent: TreeNode, name: string, path: string): TreeNode => {
    const existing = parent.children?.find(c => c.isDirectory && c.name === name)
    if (existing) return existing
    const dir: TreeNode = { name, path, isDirectory: true, isFile: false, loaded: true, children: [] }
    parent.children = parent.children || []
    parent.children.push(dir)
    return dir
  }

  for (const fullPath of filePaths) {
    const rel = fullPath.slice(rootPath.length + 1)
    if (!rel) continue
    const parts = rel.split(/[/\\]/)
    let parent = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const path = i === 0 ? `${rootPath}\\${part}` : `${parent.path}\\${part}`
      if (isLast) {
        parent.children = parent.children || []
        parent.children.push({ name: part, path: fullPath, isDirectory: false, isFile: true })
      } else {
        parent = getOrCreateDir(parent, part, path)
      }
    }
  }

  sortTree(root)
  return root
}

function sortTree(node: TreeNode) {
  if (!node.children) return
  node.children.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })
  for (const child of node.children) if (child.isDirectory) sortTree(child)
}

function ToolbarBtn({ children, onClick, title, disabled }: { children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '22px', height: '20px', background: 'transparent', border: 'none',
      color: disabled ? 'var(--text-disabled)' : 'var(--text-muted)',
      cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 'var(--radius-sm)'
    }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.color = 'var(--accent-color)'; e.currentTarget.style.background = 'var(--bg-hover)' }}}
      onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}}>
      {children}
    </button>
  )
}

function FileContextMenu({ x, y, node, onClose, onDelete, onNewFile, onNewFolder, onOpenFolder }: {
  x: number; y: number; node: TreeNode
  onClose: () => void
  onDelete: (node: TreeNode) => void
  onNewFile: (node: TreeNode) => void
  onNewFolder: (node: TreeNode) => void
  onOpenFolder: (node: TreeNode) => void
}) {
  const targetNode = node.isDirectory ? node : { ...node, isDirectory: true } as TreeNode
  const menuItem = (label: string, icon: React.ReactNode, action: () => void, danger?: boolean) => (
    <div onClick={() => { action(); onClose() }}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px',
        fontSize: '11px', fontFamily: 'var(--font-mono)', cursor: 'pointer',
        color: danger ? 'var(--error-color)' : 'var(--text-primary)',
        transition: 'background 0.1s ease'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'var(--error-bg)' : 'var(--bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
      {icon}
      {label}
    </div>
  )

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={onClose} />
      <div style={{
        position: 'fixed', left: x, top: y, zIndex: 1000,
        background: 'var(--bg-card)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        padding: '4px 0', minWidth: '180px', animation: 'fadeIn 0.1s ease'
      }}>
        {node.isDirectory && menuItem('New file', <FilePlus size={12} />, () => onNewFile(node))}
        {node.isDirectory && menuItem('New folder', <FolderPlus size={12} />, () => onNewFolder(node))}
        {menuItem('Delete', <Trash2 size={12} />, () => onDelete(node), true)}
        {menuItem('Open folder', <ExternalLink size={12} />, () => onOpenFolder(node))}
      </div>
    </>
  )
}

function TreeNodeItem({
  node, depth, onToggle, onFileSelect, selectedFile, isRoot, expandAllFlag, isVirtual, onContextMenu
}: {
  node: TreeNode; depth: number; onToggle: (node: TreeNode) => void
  onFileSelect: (filePath: string) => void; selectedFile?: string | null
  isRoot?: boolean; expandAllFlag: number; isVirtual?: boolean
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
}) {
  const isExpanded = (isVirtual || node.loaded) && node.children && node.children.length > 0
  const isSelected = selectedFile?.replace(/\//g, '\\') === node.path.replace(/\//g, '\\')
  const nodeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isSelected && nodeRef.current) {
      nodeRef.current.scrollIntoView({ block: 'center' })
    }
  }, [isSelected])

  useEffect(() => {
    if (expandAllFlag > 0 && node.isDirectory && !isVirtual) {
      // real tree expand all is handled by the parent; virtual tree is always expanded
    }
  }, [expandAllFlag])

  const handleClick = () => {
    if (node.isDirectory) { onToggle(node) }
    else { onFileSelect(node.path) }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    onContextMenu?.(e, node)
  }

  return (
    <div>
      <div onClick={handleClick} onContextMenu={handleContextMenu} data-file-path={node.path} ref={nodeRef} style={{
        display: 'flex', alignItems: 'center',
        padding: `3px 8px 3px ${8 + depth * 14}px`,
        cursor: 'pointer', fontSize: '12px', gap: '4px',
        background: isSelected ? 'var(--accent-bg)' : 'transparent',
        borderLeft: isSelected ? '3px solid var(--accent-color)' : '3px solid transparent',
        userSelect: 'none', transition: 'background 0.1s ease',
        color: isSelected ? 'var(--accent-color)' : 'var(--text-primary)',
        fontWeight: isSelected ? 600 : 400
      }}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)' }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}>
        {node.isDirectory ? (
          <>
            <ChevronRight size={12} style={{
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s ease', color: 'var(--text-muted)', flexShrink: 0
            }} />
            {isExpanded
              ? <FolderOpen size={13} style={{ color: 'var(--accent-secondary)', flexShrink: 0 }} />
              : <Folder size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
          </>
        ) : (
          <>
            <span style={{ width: '12px', flexShrink: 0 }} />
            <File size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </>
        )}
        {node.isLoading && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
          {node.name}
        </span>
      </div>
      {isExpanded && node.children?.map((child) => (
        <TreeNodeItem key={child.path} node={child} depth={depth + 1}
          onToggle={onToggle} onFileSelect={onFileSelect}
          selectedFile={selectedFile} expandAllFlag={expandAllFlag} isVirtual={isVirtual}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  )
}
