import { isLongLivedBranch } from '../../../src/shared/adoPromotion'
import type { AdoRepoList } from '../../../src/shared/adoSettings'

const basicAuth = (token: string): string => `Basic ${Buffer.from(`:${token}`).toString('base64')}`

/**
 * Repositories of one org/project with that PAT, as an answer the settings can
 * show. Standalone (it never touches the AdoService singleton), so verifying a
 * connection or reading the catalog cannot redirect a panel's calls.
 */
export async function fetchRepositories(org: string, project: string, token: string): Promise<AdoRepoList> {
  const o = org.trim()
  const p = project.trim()
  const url = `https://dev.azure.com/${encodeURIComponent(o)}/${encodeURIComponent(p)}/_apis/git/repositories?api-version=7.0`
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: basicAuth(token), Accept: 'application/json' } })
  } catch (e) {
    const err = e as Error & { cause?: { message?: string } }
    return { ok: false, error: `Azure DevOps non raggiungibile: ${err.cause?.message || err.message || String(e)}` }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'PAT non valido, scaduto o senza permesso Code (Read)' }
  if (res.status === 404) return { ok: false, error: `organization o project non trovati: ${o}/${p}` }
  // a bad PAT gets 203 + the sign-in page (or a redirect to it) instead of a 401
  if (res.status === 203) return { ok: false, error: 'PAT non valido o scaduto' }
  if (!res.ok) return { ok: false, error: `errore Azure DevOps ${res.status}` }
  let data: { value?: { name?: unknown }[] }
  try {
    data = JSON.parse(await res.text())
  } catch {
    return { ok: false, error: 'PAT non valido o scaduto' }
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.value)) return { ok: false, error: 'PAT non valido o scaduto' }
  const repos = data.value
    .map(r => (typeof r?.name === 'string' ? r.name : ''))
    .filter(n => n)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return { ok: true, repos }
}

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

export class AdoService {
  private baseUrl: string = ''
  private token: string = ''
  private currentUser: { id: string; displayName: string; emailAddress?: string } | null = null

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`,
      ...(extra || {})
    }
  }

  /** Points every following call at this org/PAT. Main only (ado:use): the PAT never crosses IPC. */
  use(org: string, token: string): void {
    this.baseUrl = `https://dev.azure.com/${org}`
    this.token = token
    this.currentUser = null
  }

  async getCurrentUser(): Promise<{ id: string; displayName: string; emailAddress?: string } | null> {
    if (this.currentUser) return this.currentUser

    const orgName = this.baseUrl.replace('https://dev.azure.com/', '').replace(/\/$/, '')
    const attempts: { url: string; kind: string }[] = [
      { url: `${this.baseUrl}/_apis/ConnectionData?api-version=1.0`, kind: 'connData-1.0' },
      { url: `${this.baseUrl}/_apis/ConnectionData?api-version=7.0-preview.1`, kind: 'connData-7.0' },
      { url: `${this.baseUrl}/DefaultCollection/_apis/ConnectionData?api-version=7.0-preview.1`, kind: 'connData-defaultcollection' },
      { url: `https://${orgName}.visualstudio.com/_apis/ConnectionData?api-version=7.0-preview.1`, kind: 'connData-legacy' },
      { url: `https://app.vssps.visualstudio.com/_apis/ConnectionData?api-version=7.0-preview.1`, kind: 'connData-vssps' }
    ]

    for (const { url, kind } of attempts) {
      try {
        const res = await fetch(url, { headers: this.authHeaders({ Accept: 'application/json' }) })
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          console.error(`[ado] getCurrentUser: ${kind} HTTP ${res.status} ${body.slice(0, 200)}`)
          continue
        }
        const data = await res.json()
        const au = data.authenticatedUser
        if (au?.id) {
          this.currentUser = {
            id: au.id,
            displayName: au.providerDisplayName || '',
            emailAddress: au.signInAddress || ''
          }
          console.error(`[ado] getCurrentUser: ${kind} OK id=${au.id}`)
          return this.currentUser
        }
        if (data.id) {
          this.currentUser = { id: data.id, displayName: data.displayName || '', emailAddress: data.emailAddress || '' }
          return this.currentUser
        }
        console.error(`[ado] getCurrentUser: ${kind} risposta senza user`, JSON.stringify(data).slice(0, 200))
      } catch (e) {
        console.error(`[ado] getCurrentUser: ${kind} eccezione`, (e as Error).message)
      }
    }
    return null
  }

  async getWorkItems(project: string): Promise<AdoWorkItem[]> {
    if (!this.baseUrl) throw new Error('Non connesso ad Azure DevOps')

    const url = `${this.baseUrl}/${project}/_apis/wit/wiql?api-version=7.0`
    const wiql = {
      query: `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State], [System.AssignedTo]
              FROM WorkItems
              WHERE [System.TeamProject] = @project
              ORDER BY [System.ChangedDate] DESC`
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`
      },
      body: JSON.stringify(wiql)
    })

    if (!res.ok) throw new Error(`ADO API error: ${res.status}`)

    const data = await res.json()
    return (data.workItems || []).map((wi: { id: number; url: string }) => ({
      id: wi.id,
      title: '',
      type: '',
      state: '',
      assignedTo: '',
      url: wi.url
    }))
  }

  async getWorkItem(project: string, id: number): Promise<AdoWorkItem | null> {
    if (!this.baseUrl) throw new Error('Non connesso ad Azure DevOps')

    const url = `${this.baseUrl}/${project}/_apis/wit/workitems/${id}?api-version=7.0`
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`
      }
    })

    if (!res.ok) return null

    const data = await res.json()
    const fields = data.fields || {}
    return {
      id: data.id,
      title: fields['System.Title'] || '',
      type: fields['System.WorkItemType'] || '',
      state: fields['System.State'] || '',
      assignedTo: fields['System.AssignedTo']?.displayName || '',
      url: data._links?.html?.href || ''
    }
  }

  /** Title/type/state of many work items in one call per 200 ids; missing ids are dropped. */
  async getWorkItemsBatch(project: string, ids: number[]): Promise<AdoWorkItem[]> {
    if (!this.baseUrl) throw new Error('Non connesso ad Azure DevOps')
    const unique = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))]
    const out: AdoWorkItem[] = []
    const fields = 'System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo'
    for (let i = 0; i < unique.length; i += 200) {
      const chunk = unique.slice(i, i + 200).join(',')
      const url = `${this.baseUrl}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${chunk}&fields=${fields}&errorPolicy=omit&api-version=7.0`
      const res = await fetch(url, { headers: this.authHeaders() })
      if (!res.ok) throw new Error(`ADO API error: ${res.status}`)
      const data = await res.json()
      for (const wi of (data.value || []) as ({ id: number; fields?: Record<string, any> } | null)[]) {
        if (!wi) continue
        const f = wi.fields || {}
        out.push({
          id: wi.id,
          title: f['System.Title'] || '',
          type: f['System.WorkItemType'] || '',
          state: f['System.State'] || '',
          assignedTo: f['System.AssignedTo']?.displayName || '',
          url: `${this.baseUrl}/${encodeURIComponent(project)}/_workitems/edit/${wi.id}`
        })
      }
    }
    return out
  }

  async getPullRequests(project: string, repo: string): Promise<AdoPullRequest[]> {
    if (!this.baseUrl) throw new Error('Non connesso ad Azure DevOps')

    const url = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests?api-version=7.0&searchCriteria.status=active`
    const res = await fetch(url, {
      headers: this.authHeaders()
    })

    if (!res.ok) return []

    const me = await this.getCurrentUser()
    const data = await res.json()
    return (data.value || []).map((pr: Record<string, unknown>) => {
      const reviewers = ((pr.reviewers as Record<string, unknown>[]) || []).map(r => ({
        id: String(r.id || ''),
        displayName: (r.displayName as string) || '',
        uniqueName: (r.uniqueName as string) || '',
        vote: (r.vote as number) || 0,
        isRequired: r.isRequired as boolean || false
      }))
      const isActive = pr.status !== 'abandoned' && !pr.isDraft
      const mineReview = me
        ? reviewers.find(r => r.id.toLowerCase() === me.id.toLowerCase() || r.uniqueName.toLowerCase() === (me.emailAddress || me.id).toLowerCase() || r.displayName.toLowerCase() === me.displayName.toLowerCase())
        : undefined
      const myVote = mineReview?.vote ?? 0
      const needsApproval = !!isActive && !!mineReview && myVote === 0
      return {
        id: pr.pullRequestId as number,
        title: (pr.title as string) || '',
        status: (pr.status as string) || '',
        sourceBranch: ((pr.sourceRefName as string) || '').replace('refs/heads/', ''),
        targetBranch: ((pr.targetRefName as string) || '').replace('refs/heads/', ''),
        createdBy: ((pr.createdBy as Record<string, unknown>)?.displayName as string) || '',
        isDraft: pr.isDraft as boolean || false,
        needsApproval,
        myVote,
        reviewers,
        url: ((pr as Record<string, unknown>)._links as Record<string, { href: string }>)?.web?.href || ''
      }
    })
  }

  async getPullRequestDetail(project: string, repo: string, prId: number): Promise<AdoPullRequestDetail | null> {
    if (!this.baseUrl) throw new Error('Non connesso ad Azure DevOps')

    const url = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests/${prId}?api-version=7.0`
    const res = await fetch(url, { headers: this.authHeaders() })
    if (!res.ok) return null

    const pr = await res.json()
    const reviewers = ((pr.reviewers as Record<string, unknown>[]) || []).map((r: Record<string, unknown>) => ({
      id: String(r.id || ''),
      displayName: (r.displayName as string) || '',
      uniqueName: (r.uniqueName as string) || '',
      vote: (r.vote as number) || 0,
      isRequired: r.isRequired as boolean || false
    }))
    const me = await this.getCurrentUser()
    const mine = me
      ? reviewers.find(r => r.id.toLowerCase() === me.id.toLowerCase() || r.uniqueName.toLowerCase() === (me.emailAddress || me.id).toLowerCase() || r.displayName.toLowerCase() === me.displayName.toLowerCase())
      : undefined
    return {
      id: pr.pullRequestId,
      title: pr.title || '',
      status: pr.status || '',
      sourceBranch: (pr.sourceRefName || '').replace('refs/heads/', ''),
      targetBranch: (pr.targetRefName || '').replace('refs/heads/', ''),
      createdBy: pr.createdBy?.displayName || '',
      isDraft: pr.isDraft || false,
      needsApproval: !!mine && mine.vote === 0 && pr.status !== 'abandoned',
      myVote: mine?.vote ?? 0,
      reviewers,
      url: pr._links?.web?.href || '',
      sourceCommitId: pr.lastMergeSourceCommit?.commitId || '',
      targetCommitId: pr.lastMergeTargetCommit?.commitId || ''
    }
  }

  async getPullRequestFiles(project: string, repo: string, prId: number): Promise<AdoPullRequestFile[]> {
    if (!this.baseUrl) throw new Error('Non connesso ad Azure DevOps')

    const iterRes = await fetch(`${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests/${prId}/iterations?api-version=7.0`, {
      headers: this.authHeaders()
    })
    if (!iterRes.ok) return []
    const iterData = await iterRes.json()
    const iterations = iterData.value || []
    if (iterations.length === 0) return []
    const lastIterationId = iterations[iterations.length - 1].id

    const changesRes = await fetch(`${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests/${prId}/iterations/${lastIterationId}/changes?api-version=7.0`, {
      headers: this.authHeaders()
    })
    if (!changesRes.ok) return []
    const changesData = await changesRes.json()

    return (changesData.changeEntries || []).map((e: Record<string, unknown>) => ({
      path: (e.item as Record<string, unknown>)?.path as string || '',
      changeType: (e.changeType as string) || 'edit'
    })).filter((f: { path: string }) => f.path)
  }

  async getFileContent(project: string, repo: string, path: string, commitId: string): Promise<string> {
    const url = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${encodeURIComponent(commitId)}&versionDescriptor.versionType=commit&api-version=7.0`
    const res = await fetch(url, { headers: this.authHeaders({ Accept: 'text/plain' }) })
    if (!res.ok) return ''
    return await res.text()
  }

  async getPullRequestThreads(project: string, repo: string, prId: number): Promise<{ comments: { author: string; content: string }[]; active: boolean }[]> {
    if (!this.baseUrl) throw new Error('Non connesso ad Azure DevOps')

    const url = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests/${prId}/threads?api-version=7.0`
    const res = await fetch(url, { headers: this.authHeaders() })
    if (!res.ok) return []

    const data = await res.json()
    return (data.value || []).map((t: Record<string, unknown>) => ({
      active: t.status !== 'closed' && t.status !== 'fixed',
      comments: ((t.comments as Record<string, unknown>[]) || []).map(c => ({
        author: ((c.author as Record<string, unknown>)?.displayName as string) || '',
        content: (c.content as string) || ''
      }))
    }))
  }

  async getBranches(project: string, repo: string): Promise<string[]> {
    // the route is refs/{*filter}: `refs/branches` matched nothing, the filter is the ref prefix after `refs/`
    const url = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/refs?filter=heads/&api-version=7.0`
    const res = await fetch(url, { headers: this.authHeaders() })
    if (!res.ok) return []
    const data = await res.json()
    return (data.value || [])
      .map((r: Record<string, unknown>) => ((r.name as string) || '').replace(/^refs\/heads\//, ''))
      .filter((b: string) => b)
  }

  async getRepositories(project: string): Promise<string[]> {
    if (!this.baseUrl) return []
    const url = `${this.baseUrl}/${project}/_apis/git/repositories?api-version=7.0`
    const res = await fetch(url, { headers: this.authHeaders() })
    if (!res.ok) return []
    const data = await res.json()
    return (data.value || []).map((r: Record<string, unknown>) => (r.name as string) || '').filter((n: string) => n)
  }

  /** `strict`: an error answer throws (the release chain retries) instead of reading as "no commit". */
  async getCommitsBetween(project: string, repo: string, sourceRef: string, targetRef: string, opts?: { strict?: boolean }): Promise<{ commitId: string; message: string; author: string }[]> {
    // ponytail: one page of 1000 commits (no paging); a bigger promotion lists only the newest 1000
    // Azure DevOps returns the commits of compareVersion that itemVersion cannot reach (git log
    // item..compare): the target goes in itemVersion, the source in compareVersion. The other way
    // round lists what the target has and the source lacks (Themis-API: 660 instead of 6).
    const url = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(targetRef)}&searchCriteria.itemVersion.versionType=branch&searchCriteria.compareVersion.version=${encodeURIComponent(sourceRef)}&searchCriteria.compareVersion.versionType=branch&searchCriteria.$top=1000&api-version=7.0`
    let data: { value?: Record<string, unknown>[] }
    if (opts?.strict) {
      data = await this.getJson(url)
    } else {
      const res = await fetch(url, { headers: this.authHeaders() })
      if (!res.ok) return []
      data = await res.json()
    }
    return (Array.isArray(data?.value) ? data.value : []).map((c: Record<string, unknown>) => ({
      commitId: c.commitId as string || '',
      message: (c.comment as string) || '',
      author: ((c.author as Record<string, unknown>)?.name as string) || ''
    }))
  }

  /**
   * GET that throws a readable Italian message on anything but a JSON answer
   * (network, PAT, 404, sign-in page): the release chain keeps it as its last error and retries.
   */
  private async getJson(url: string): Promise<any> {
    let res: Response
    try {
      res = await fetch(url, { headers: this.authHeaders({ Accept: 'application/json' }) })
    } catch (e) {
      const err = e as Error & { cause?: { message?: string } }
      throw new Error(`Azure DevOps non raggiungibile: ${err.cause?.message || err.message || String(e)}`)
    }
    if (res.status === 401 || res.status === 403) throw new Error('PAT non valido, scaduto o senza permesso Code (Read)')
    if (res.status === 404) throw new Error('non trovato in Azure DevOps (repository o pull request rinominate o rimosse?)')
    // a bad PAT gets 203 + the sign-in page instead of a 401
    if (res.status === 203) throw new Error('PAT non valido o scaduto')
    if (!res.ok) throw new Error(`errore Azure DevOps ${res.status}`)
    try {
      return JSON.parse(await res.text())
    } catch {
      throw new Error('PAT non valido o scaduto')
    }
  }

  private prWebUrl(project: string, repo: string, prId: number): string {
    return `${this.baseUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${prId}`
  }

  /** Status of one pull request ('active' | 'completed' | 'abandoned'); throws when Azure DevOps does not answer. */
  async getPullRequestState(project: string, repo: string, prId: number): Promise<{ id: number; status: string; url: string }> {
    if (!this.baseUrl) throw new Error('Non connesso ad Azure DevOps')
    const data = await this.getJson(`${this.baseUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${prId}?api-version=7.0`)
    return { id: Number(data?.pullRequestId) || prId, status: String(data?.status ?? ''), url: this.prWebUrl(project, repo, prId) }
  }

  /** The active pull request from `sourceRef` to `targetRef`, null when there is none; throws when Azure DevOps does not answer. */
  async findActivePullRequest(project: string, repo: string, sourceRef: string, targetRef: string): Promise<{ id: number; url: string } | null> {
    if (!this.baseUrl) throw new Error('Non connesso ad Azure DevOps')
    const ref = (b: string) => encodeURIComponent(`refs/heads/${b.replace(/^refs\/heads\//, '')}`)
    const data = await this.getJson(`${this.baseUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests?searchCriteria.status=active&searchCriteria.sourceRefName=${ref(sourceRef)}&searchCriteria.targetRefName=${ref(targetRef)}&api-version=7.0`)
    const first = (Array.isArray(data?.value) ? data.value : []).find((p: { pullRequestId?: unknown }) => Number(p?.pullRequestId) > 0)
    if (!first) return null
    const id = Number(first.pullRequestId)
    return { id, url: this.prWebUrl(project, repo, id) }
  }

  async setVote(project: string, repo: string, prId: number, vote: number): Promise<boolean> {
    const me = await this.getCurrentUser()
    if (!me) {
      console.error('[ado] setVote: getCurrentUser null')
      return false
    }
    // PUT to reviewers/{me.id} both adds the user as reviewer (if not present)
    // and sets their vote — same behaviour as the web UI, so it works even for
    // PRs with no designated reviewers.
    const voteUrl = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests/${prId}/reviewers/${me.id}?api-version=7.0`
    const res = await fetch(voteUrl, {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ vote })
    })
    if (!res.ok) console.error('[ado] setVote: PUT fallita', res.status, await res.text().catch(() => ''))
    return res.ok
  }

  // Explicit override reason for completions that would otherwise be blocked by
  // branch policies that aren't passing (required reviewers/builds, etc.).
  private readonly bypassReason = 'Completata da DamnedIDE (chiusura worktree) — bypass policy esplicito'

  async completePr(project: string, repo: string, prId: number, sourceCommitId: string, deleteSourceBranch = true): Promise<boolean> {
    const url = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests/${prId}?api-version=7.0`
    const res = await fetch(url, {
      method: 'PATCH',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        status: 'completed',
        lastMergeSourceCommit: { commitId: sourceCommitId },
        // real merge commit (no squash): the feature branch stays visible in the git graph
        completionOptions: { deleteSourceBranch, mergeStrategy: 'noFastForward' },
        // let the merge go through even when a branch policy isn't passing
        bypassReason: this.bypassReason
      })
    })
    if (!res.ok) console.error('[ado] completePr: PATCH fallita', res.status, await res.text().catch(() => ''))
    return res.ok
  }

  // Complete a fresh PR directly: ADO may not have computed lastMergeSourceCommit yet,
  // so retry a few times and, if still missing, complete without it (ADO uses the head).
  private async completePrDirect(project: string, repo: string, prId: number, initialCommitId: string, deleteSourceBranch: boolean): Promise<boolean> {
    let commitId = initialCommitId
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!commitId) commitId = await this.getPrSourceCommit(project, repo, prId)
      const url = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests/${prId}?api-version=7.0`
      const body: Record<string, unknown> = {
        status: 'completed',
        completionOptions: { deleteSourceBranch, mergeStrategy: 'noFastForward' },
        // bypass branch policies that aren't passing (explicit override)
        bypassReason: this.bypassReason
      }
      if (commitId) body.lastMergeSourceCommit = { commitId }
      const res = await fetch(url, {
        method: 'PATCH',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      })
      if (res.ok) return true
      console.error(`[ado] completePrDirect: tentativo ${attempt + 1} fallito`, res.status, await res.text().catch(() => ''))
      await new Promise(r => setTimeout(r, 1500))
    }
    return false
  }

  // Arms auto-complete on a PR and VERIFIES it actually took (ADO can silently ignore
  // the PATCH when there are no required reviewers/policies, or fail transiently).
  private async armAutoComplete(project: string, repo: string, prId: number, opts: { title: string; deleteSourceBranch?: boolean }): Promise<boolean> {
    const patchUrl = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests/${prId}?api-version=7.0`
    const res = await fetch(patchUrl, {
      method: 'PATCH',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        completionOptions: {
          autoComplete: true,
          deleteSourceBranch: opts.deleteSourceBranch ?? true,
          mergeStrategy: 'noFastForward',
          mergeCommitMessage: opts.title
        }
      })
    })
    if (!res.ok) {
      console.error('[ado] armAutoComplete: PATCH fallita', res.status, await res.text().catch(() => ''))
      return false
    }
    // verify the arm actually took
    try {
      const check = await fetch(patchUrl, { headers: this.authHeaders() })
      if (check.ok) {
        const pr = await check.json()
        return pr.completionOptions?.autoComplete === true || !!pr.autoCompleteSetBy
      }
    } catch { /* verification failed */ }
    return false
  }

  // Adds the current user as a REQUIRED reviewer AND approves the PR in one call:
  // ADO arms auto-complete only when the PR has a required reviewer, and the merge
  // then proceeds once that reviewer has approved.
  private async addRequiredReviewer(project: string, repo: string, prId: number, reviewerId: string): Promise<boolean> {
    const url = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests/${prId}/reviewers/${reviewerId}?api-version=7.0`
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ isRequired: true, vote: 10 })
    })
    if (!res.ok) console.error('[ado] addRequiredReviewer: PUT fallita', res.status, await res.text().catch(() => ''))
    return res.ok
  }

  private async getPrSourceCommit(project: string, repo: string, prId: number): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests/${prId}?api-version=7.0`, {
        headers: this.authHeaders()
      })
      if (!res.ok) return ''
      const data = await res.json()
      return data.lastMergeSourceCommit?.commitId || ''
    } catch {
      return ''
    }
  }

  async createPullRequest(project: string, repo: string, opts: {
    sourceRef: string
    targetRef: string
    title: string
    description: string
    autoComplete: boolean
    deleteSourceBranch?: boolean
    /** false: only arm auto-complete, never self-approve nor complete with a policy bypass (default true) */
    forceComplete?: boolean
    workItemIds?: number[]
  }): Promise<{ id: number; title: string; mode: 'autocomplete' | 'completed' | 'open'; url: string } | null> {
    // a merge never deletes develop/qa/main unless the caller asks for it explicitly
    const deleteSourceBranch = opts.deleteSourceBranch ?? !isLongLivedBranch(opts.sourceRef)
    const forceComplete = opts.forceComplete ?? true
    const url = `${this.baseUrl}/${project}/_apis/git/repositories/${repo}/pullrequests?api-version=7.0`
    const body: Record<string, unknown> = {
      sourceRefName: `refs/heads/${opts.sourceRef}`,
      targetRefName: `refs/heads/${opts.targetRef}`,
      title: opts.title,
      description: opts.description,
      isDraft: false
    }
    // Link the work items to the PR so completion transitions them (ADO also picks
    // up #<id> references from the title/description and the commit messages).
    if (opts.workItemIds && opts.workItemIds.length > 0) {
      body.workItemRefs = opts.workItemIds.map(id => ({ id }))
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      console.error('[ado] createPr: POST fallita', res.status, await res.text().catch(() => ''))
      return null
    }
    const data = await res.json()
    const prId = data.pullRequestId as number
    const sourceCommitId = (data.lastMergeSourceCommit?.commitId as string) || ''
    const prUrl = this.prWebUrl(project, repo, prId)

    if (opts.autoComplete && prId) {
      const armOpts = { title: opts.title, deleteSourceBranch }
      // 1) arm auto-complete with a dedicated PATCH and verify it actually took
      let armed = await this.armAutoComplete(project, repo, prId, armOpts)
      if (!armed && !forceComplete) {
        // promotion PRs: branch policies decide, the PR just stays open
        console.error('[ado] createPr: auto-complete non armato, PR lasciata aperta (forceComplete=false)')
        return { id: prId, title: data.title as string || '', mode: 'open', url: prUrl }
      }
      if (!armed) {
        // ADO refuses auto-complete when the PR has no required reviewers/policies:
        // add the current user as a REQUIRED reviewer on this PR, then retry arming.
        const me = await this.getCurrentUser()
        if (me) {
          const added = await this.addRequiredReviewer(project, repo, prId, me.id)
          console.error(`[ado] createPr: reviewer richiesto aggiunto e approvato=${added} per armare l'auto-complete`)
          if (added) armed = await this.armAutoComplete(project, repo, prId, armOpts)
        }
      }
      if (armed) {
        return { id: prId, title: data.title as string || '', mode: 'autocomplete', url: prUrl }
      }
      console.error('[ado] createPr: auto-complete non armabile, completo direttamente')
      // 2) last resort: complete directly so develop gets the merge
      const completed = await this.completePrDirect(project, repo, prId, sourceCommitId, deleteSourceBranch)
      if (completed) {
        return { id: prId, title: data.title as string || '', mode: 'completed', url: prUrl }
      }
      console.error('[ado] createPr: complete diretta fallita')
      return { id: prId, title: data.title as string || '', mode: 'open', url: prUrl }
    }

    return { id: prId, title: data.title as string || '', mode: 'open', url: prUrl }
  }
}
