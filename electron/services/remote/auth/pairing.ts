import { randomBytes } from 'crypto'
import type { ConfirmationChallenge } from '../../../../src/shared/remote/protocol'

const PAIRING_TTL_MS = 2 * 60 * 1000
const CHALLENGE_TTL_MS = 2 * 60 * 1000

interface PendingToken {
  token: string
  expiresAt: number
}

/**
 * Short-lived one-time pairing tokens and destructive-action confirmation
 * challenges. Everything is in-memory: a restart simply invalidates them.
 */
export class PairingService {
  private tokens = new Map<string, PendingToken>()
  private challenges = new Map<string, ConfirmationChallenge>()

  // ─── Pairing tokens ───────────────────────────────────────────────────────

  begin(): { token: string; expiresAt: number } {
    this.sweep()
    const token = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + PAIRING_TTL_MS
    this.tokens.set(token, { token, expiresAt })
    return { token, expiresAt }
  }

  /** Validate a pairing token without consuming it (consume on success). */
  peek(token: string): boolean {
    this.sweep()
    const entry = this.tokens.get(token)
    return !!entry && entry.expiresAt > Date.now()
  }

  consume(token: string): boolean {
    this.sweep()
    const entry = this.tokens.get(token)
    if (!entry || entry.expiresAt <= Date.now()) return false
    this.tokens.delete(token)
    return true
  }

  cancel(token: string): void {
    this.tokens.delete(token)
  }

  // ─── Confirmation challenges ──────────────────────────────────────────────

  challenge(command: string, summary: string, details: string | undefined, destructive: boolean): ConfirmationChallenge {
    this.sweep()
    const challenge: ConfirmationChallenge = {
      id: randomBytes(12).toString('base64url'),
      command,
      summary,
      details,
      destructive,
      createdAt: Date.now(),
      expiresAt: Date.now() + CHALLENGE_TTL_MS
    }
    this.challenges.set(challenge.id, challenge)
    return challenge
  }

  /** Consume a challenge if it belongs to `command` and has not expired. */
  resolveChallenge(id: string, command: string): boolean {
    this.sweep()
    const found = this.challenges.get(id)
    if (!found || found.command !== command || found.expiresAt <= Date.now()) return false
    this.challenges.delete(id)
    return true
  }

  private sweep(): void {
    const now = Date.now()
    for (const [k, v] of this.tokens) if (v.expiresAt <= now) this.tokens.delete(k)
    for (const [k, v] of this.challenges) if (v.expiresAt <= now) this.challenges.delete(k)
  }
}
