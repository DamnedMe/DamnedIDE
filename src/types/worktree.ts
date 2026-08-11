export interface WorktreeEntry {
  path: string
  head: string
  branch: string
  bare: boolean
  detached: boolean
}

export interface WorktreeWithStatus extends WorktreeEntry {
  isMain: boolean
  hasChanges: boolean
  modifiedCount: number
  aheadCount: number
  behindCount: number
  lastCommitDate: string | null
}
