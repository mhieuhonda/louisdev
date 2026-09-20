import { type Chain, orderedSources, type Source } from "@louisdev/config"
import { type AttemptFailure, classifyRefusal, type Refusal } from "./errors.ts"
import {
  type BackoffPolicy,
  DEFAULT_BACKOFF,
  initialState,
  recordRefusal,
  recordSuccess,
  type SourceState,
  statusAt,
} from "./state.ts"

export interface SourceView {
  source: Source
  status: "ok" | "cooling" | "exhausted"
  /** Milliseconds until usable again. 0 when usable now. */
  waitMs: number
  consecutiveRefusals: number
  lastMessage: string | undefined
}

/**
 * Rotation + quota tracking for one chain. Pure logic over injected `now`,
 * so the wait-and-resume loop and the quota board share one source of truth.
 */
export class QuotaManager {
  private readonly sources: Source[]
  private readonly states = new Map<string, SourceState>()
  private readonly policy: BackoffPolicy

  constructor(chain: Chain, policy: BackoffPolicy = DEFAULT_BACKOFF) {
    this.sources = orderedSources(chain)
    this.policy = policy
    for (const source of this.sources) this.states.set(source.id, initialState(source.id))
  }

  private stateOf(sourceId: string): SourceState {
    const state = this.states.get(sourceId)
    if (!state) throw new Error(`unknown source: ${sourceId}`)
    return state
  }

  /** First usable source by priority, or undefined when all are parked. */
  pick(now: number = Date.now()): Source | undefined {
    return this.sources.find((source) => statusAt(this.stateOf(source.id), now) === "ok")
  }

  /** Fold a raw failure into quota state. Returns the classified refusal. */
  refuse(sourceId: string, failure: AttemptFailure, now: number = Date.now()): Refusal {
    const refusal = classifyRefusal(failure)
    this.states.set(sourceId, recordRefusal(this.stateOf(sourceId), refusal, now, this.policy))
    return refusal
  }

  succeed(sourceId: string): void {
    this.states.set(sourceId, recordSuccess(this.stateOf(sourceId)))
  }

  /**
   * Milliseconds until the fastest parked source recovers.
   * Undefined when at least one source is usable now.
   */
  nextRecoveryMs(now: number = Date.now()): number | undefined {
    if (this.pick(now) !== undefined) return undefined
    let wait: number | undefined
    for (const source of this.sources) {
      const state = this.stateOf(source.id)
      if (statusAt(state, now) === "ok") return undefined
      const remaining = state.availableAt - now
      if (remaining > 0 && (wait === undefined || remaining < wait)) wait = remaining
    }
    return wait
  }

  /** Snapshot for the quota board. Sorted in chain priority order. */
  snapshot(now: number = Date.now()): SourceView[] {
    return this.sources.map((source) => {
      const state = this.stateOf(source.id)
      const status = statusAt(state, now)
      return {
        source,
        status,
        waitMs: status === "ok" ? 0 : Math.max(0, state.availableAt - now),
        consecutiveRefusals: state.consecutiveRefusals,
        lastMessage: state.lastMessage,
      }
    })
  }
}
