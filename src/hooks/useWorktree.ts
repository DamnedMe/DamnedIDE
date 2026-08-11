import { useCallback } from 'react'

export function useWorktree(repoPath: string | null) {
  const list = useCallback(async () => {
    if (!repoPath) return []
    return window.electronAPI.worktree.list(repoPath)
  }, [repoPath])

  const add = useCallback(async (branch: string, path: string) => {
    if (!repoPath) return
    await window.electronAPI.worktree.add(repoPath, branch, path)
  }, [repoPath])

  const remove = useCallback(async (worktreePath: string) => {
    if (!repoPath) return
    await window.electronAPI.worktree.remove(repoPath, worktreePath)
  }, [repoPath])

  const prune = useCallback(async () => {
    if (!repoPath) return
    await window.electronAPI.worktree.prune(repoPath)
  }, [repoPath])

  return { list, add, remove, prune }
}
