export interface AdoWorkItem {
  id: number
  title: string
  type: string
  state: string
  assignedTo: string
  url: string
}

export interface AdoReviewer {
  displayName: string
  uniqueName: string
  vote: number
  isRequired: boolean
}

export interface AdoPullRequest {
  id: number
  title: string
  status: string
  sourceBranch: string
  targetBranch: string
  createdBy: string
  isDraft: boolean
  needsApproval: boolean
  myVote: number
  reviewers: AdoReviewer[]
  url: string
}

export interface AdoPullRequestDetail extends AdoPullRequest {
  sourceCommitId: string
  targetCommitId: string
}

export interface AdoPullRequestFile {
  path: string
  changeType: string
}

export interface AdoPullRequestThread {
  active: boolean
  comments: { author: string; content: string }[]
}

export interface AdoConnection {
  organization: string
  project: string
  repository: string
  token: string
  isConnected: boolean
}
