import type { Refusal } from "./errors.ts"

export type SourceStatus = "ok" | "cooling" | "exhausted"

export interface SourceState {
  sourceId: string
  status: SourceStatus
  /** Epoch ms when the source may be tried again. */
  availableAt: number
  consecutiveRefusals: number
  lastMessage: string | undefined
}

export interface BackoffPolicy {
  baseCooldownMs: number
  maxCooldownMs: number
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseCooldownMs: 2_000,
  maxCooldownMs: 5 * 60_000,
}

export function initialState(sourceId: string): SourceState {
  return { sourceId, status: "ok", availableAt: 0, consecutiveRefusals: 0, lastMessage: undefined }
}

/** Milliseconds from now until next UTC midnight (daily quota reset). */
export function msTillUtcMidnight(now: number): number {
  const day = 86_400_000
  return day - (now % day)
}

/** Status at a point in time. Cooldowns expire automatically. */
export function statusAt(state: SourceState, now: number): SourceStatus {
  if (state.status !== "ok" && now >= state.availableAt) return "ok"
  return state.status
}

function backoffMs(refusals: number, policy: BackoffPolicy): number {
  return Math.min(policy.baseCooldownMs * 2 ** Math.max(0, refusals - 1), policy.maxCooldownMs)
}

/**
 * Fold a refusal into state. Pure - caller supplies `now` for testability.
 * - auth: source stays usable in rotation but flagged; quota manager
 *   surfaces it instead of retrying blindly (handled by caller).
 * - quota_exhausted: parked until retry-after or UTC midnight.
 * - rate_limited/transient/unknown: exponential cooldown.
 */
export function recordRefusal(
  state: SourceState,
  refusal: Refusal,
  now: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
): SourceState {
  const consecutiveRefusals = state.consecutiveRefusals + 1
  if (refusal.kind === "auth") {
    return {
      ...state,
      status: "cooling",
      availableAt: Number.MAX_SAFE_INTEGER,
      consecutiveRefusals,
      lastMessage: refusal.message,
    }
  }
  if (refusal.kind === "quota_exhausted") {
    const waitMs = refusal.retryAfterSec !== undefined ? refusal.retryAfterSec * 1000 : msTillUtcMidnight(now)
    return {
      ...state,
      status: "exhausted",
      availableAt: now + waitMs,
      consecutiveRefusals,
      lastMessage: refusal.message,
    }
  }
  const waitMs =
    refusal.retryAfterSec !== undefined
      ? refusal.retryAfterSec * 1000
      : backoffMs(consecutiveRefusals, policy)
  return {
    ...state,
    status: "cooling",
    availableAt: now + Math.min(waitMs, policy.maxCooldownMs),
    consecutiveRefusals,
    lastMessage: refusal.message,
  }
}

/** A success clears the refusal streak and re-opens the source. */
export function recordSuccess(state: SourceState): SourceState {
  return { ...state, status: "ok", availableAt: 0, consecutiveRefusals: 0, lastMessage: undefined }
}
