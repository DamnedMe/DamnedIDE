import { useCallback } from 'react'

export function useGit(repoPath: string | null) {
  const refresh = useCallback(async () => {
    if (!repoPath) return null
    return window.electronAPI.git.status(repoPath)
  }, [repoPath])

  const stage = useCallback(async (files: string[]) => {
    if (!repoPath) return
    await window.electronAPI.git.stage(repoPath, files)
  }, [repoPath])

  const unstage = useCallback(async (files: string[]) => {
    if (!repoPath) return
    await window.electronAPI.git.unstage(repoPath, files)
  }, [repoPath])

  const commit = useCallback(async (message: string) => {
    if (!repoPath) return
    await window.electronAPI.git.commit(repoPath, message)
  }, [repoPath])

  return { refresh, stage, unstage, commit }
}
