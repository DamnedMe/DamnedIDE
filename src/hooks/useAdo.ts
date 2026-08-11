import { useCallback } from 'react'
import { AdoWorkItem, AdoPullRequest, AdoConnection } from '../types/ado'

export function useAdo() {
  const connect = useCallback(async (org: string, token: string): Promise<boolean> => {
    return window.electronAPI.ado.connect(org, token)
  }, [])

  const getWorkItems = useCallback(async (project: string): Promise<AdoWorkItem[]> => {
    return window.electronAPI.ado.workItems(project)
  }, [])

  const getWorkItem = useCallback(async (project: string, id: number): Promise<AdoWorkItem | null> => {
    return window.electronAPI.ado.workItem(project, id)
  }, [])

  const getPullRequests = useCallback(async (project: string, repo: string): Promise<AdoPullRequest[]> => {
    return window.electronAPI.ado.pullRequests(project, repo)
  }, [])

  return { connect, getWorkItems, getWorkItem, getPullRequests }
}
