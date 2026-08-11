export interface GitFileStatus {
  path: string
  index: string
  workingDir: string
  staged: boolean
  unstaged: boolean
  isNew: boolean
  isModified: boolean
  isDeleted: boolean
  isRenamed: boolean
}

export interface GitStatus {
  current: string
  tracking: string
  conflicted: string[]
  created: string[]
  deleted: string[]
  modified: string[]
  not_added: string[]
  staged: string[]
  ahead: number
  behind: number
  isClean: boolean
}

export interface BranchInfo {
  name: string
  current: boolean
  remote: boolean
}

export interface CommitInfo {
  hash: string
  date: string
  message: string
  authorName: string
  authorEmail: string
}
