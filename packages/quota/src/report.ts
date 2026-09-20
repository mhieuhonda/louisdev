export interface SourceTally {
  sourceId: string
  requests: number
  refusals: number
  successes: number
}

export interface SqueezeSummary {
  sources: SourceTally[]
  totalRequests: number
  totalRefusals: number
}

/**
 * "How much free did you squeeze" - per-source tallies behind the
 * end-of-session squeeze report. Tokens are counted by the agent layer;
 * the quota package only tracks attempts and outcomes.
 */
export class SqueezeReport {
  private readonly tallies = new Map<string, SourceTally>()

  private tally(sourceId: string): SourceTally {
    const existing = this.tallies.get(sourceId)
    if (existing) return existing
    const fresh: SourceTally = { sourceId, requests: 0, refusals: 0, successes: 0 }
    this.tallies.set(sourceId, fresh)
    return fresh
  }

  recordRequest(sourceId: string): void {
    this.tally(sourceId).requests += 1
  }

  recordSuccess(sourceId: string): void {
    this.tally(sourceId).successes += 1
  }

  recordRefusal(sourceId: string): void {
    this.tally(sourceId).refusals += 1
  }

  summary(): SqueezeSummary {
    const sources = [...this.tallies.values()].toSorted((a, b) => a.sourceId.localeCompare(b.sourceId))
    return {
      sources,
      totalRequests: sources.reduce((sum, tally) => sum + tally.requests, 0),
      totalRefusals: sources.reduce((sum, tally) => sum + tally.refusals, 0),
    }
  }
}
