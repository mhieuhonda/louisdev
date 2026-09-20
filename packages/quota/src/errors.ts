/** Unified refusal taxonomy. Decides what LouisDev does next. */
export type RefusalKind = "rate_limited" | "quota_exhausted" | "transient" | "auth" | "unknown"

export interface Refusal {
  kind: RefusalKind
  /** Seconds until the source may accept requests again, if known. */
  retryAfterSec: number | undefined
  message: string
}

/** Raw failure details from one attempt against a source. */
export interface AttemptFailure {
  status: number | undefined
  headers: Record<string, string | undefined>
  body: string | undefined
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

function parseRetryAfterSec(headers: Record<string, string | undefined>): number | undefined {
  const ms = header(headers, "retry-after-ms")
  if (ms !== undefined) {
    const parsed = Number.parseFloat(ms)
    if (Number.isFinite(parsed) && parsed >= 0) return Math.ceil(parsed / 1000)
  }
  const sec = header(headers, "retry-after")
  if (sec !== undefined) {
    const parsed = Number.parseFloat(sec)
    if (Number.isFinite(parsed) && parsed >= 0) return Math.ceil(parsed)
    const dateMs = Date.parse(sec) - Date.now()
    if (Number.isFinite(dateMs) && dateMs > 0) return Math.ceil(dateMs / 1000)
  }
  return undefined
}

/**
 * Classify a failed attempt. Pure function - no I/O, no clock.
 * - FreeUsageLimitError in body -> quota_exhausted (daily budget gone)
 * - 401/403 -> auth (key wrong/revoked, never auto-retry)
 * - 429 -> rate_limited (temporary, honor retry-after)
 * - 5xx or unreachable -> transient (backoff and retry same source)
 */
export function classifyRefusal(failure: AttemptFailure): Refusal {
  const body = failure.body ?? ""
  if (body.includes("FreeUsageLimitError")) {
    return {
      kind: "quota_exhausted",
      retryAfterSec: parseRetryAfterSec(failure.headers),
      message: "free quota exhausted for today",
    }
  }
  if (failure.status === 401 || failure.status === 403) {
    return {
      kind: "auth",
      retryAfterSec: undefined,
      message: `authentication refused (HTTP ${failure.status})`,
    }
  }
  if (failure.status === 429) {
    return {
      kind: "rate_limited",
      retryAfterSec: parseRetryAfterSec(failure.headers),
      message: "rate limited by source",
    }
  }
  if (failure.status === undefined || failure.status >= 500) {
    return {
      kind: "transient",
      retryAfterSec: parseRetryAfterSec(failure.headers),
      message: failure.status === undefined ? "source unreachable" : `source error (HTTP ${failure.status})`,
    }
  }
  return { kind: "unknown", retryAfterSec: undefined, message: `unexpected refusal (HTTP ${failure.status})` }
}
