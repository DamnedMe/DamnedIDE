import { EventEmitter } from 'events'
import type { RemoteApply, WorkspaceSnapshot } from '../../../src/shared/remote/protocol'

const EMPTY: WorkspaceSnapshot = {
  revision: 0,
  repoPath: null,
  selectedWorktree: null,
  activePanel: 'worktree',
  editorNav: null
}

/**
 * Authoritative workspace state for remote clients.
 *
 * The desktop renderer owns the real UI state; it pushes snapshots here on every
 * change. Remote clients read this snapshot and, when a command mutates the
 * desktop UI, the change is forwarded back to the renderer through `apply()`.
 */
export class WorkspaceState {
  private snapshot: WorkspaceSnapshot = { ...EMPTY }
  private readonly emitter = new EventEmitter()
  private applyHandler: ((change: RemoteApply) => void) | null = null

  get(): WorkspaceSnapshot {
    return this.snapshot
  }

  /** Called by the renderer whenever the desktop UI state changes. */
  update(patch: Partial<Omit<WorkspaceSnapshot, 'revision'>>): WorkspaceSnapshot {
    this.snapshot = { ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 }
    this.emitter.emit('changed', this.snapshot)
    return this.snapshot
  }

  onChanged(listener: (snapshot: WorkspaceSnapshot) => void): () => void {
    this.emitter.on('changed', listener)
    return () => this.emitter.off('changed', listener)
  }

  /** The renderer registers itself here to receive UI changes from remotes. */
  setApplyHandler(handler: ((change: RemoteApply) => void) | null): void {
    this.applyHandler = handler
  }

  /** Ask the desktop renderer to apply a change (mirror). */
  apply(change: RemoteApply): WorkspaceSnapshot {
    try {
      this.applyHandler?.(change)
    } catch {
      /* renderer closing */
    }
    return this.snapshot
  }
}
