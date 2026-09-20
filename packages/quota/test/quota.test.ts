import { describe, expect, test } from "bun:test"
import { defaultChain, type Source } from "@louisdev/config"
import { classifyRefusal } from "../src/errors.ts"
import { QuotaManager } from "../src/manager.ts"
import { SqueezeReport } from "../src/report.ts"
import { initialState, msTillUtcMidnight, recordSuccess, statusAt } from "../src/state.ts"
import { trustNotices } from "../src/trust.ts"

function source(id: string, priority = 100): Source {
  const first = defaultChain().sources[0]
  if (!first) throw new Error("default chain is empty")
  return { ...first, id, priority }
}

describe("classifyRefusal", () => {
  test("FreeUsageLimitError means quota exhausted", () => {
    const refusal = classifyRefusal({
      status: 429,
      headers: { "retry-after": "60" },
      body: "x FreeUsageLimitError y",
    })
    expect(refusal.kind).toBe("quota_exhausted")
    expect(refusal.retryAfterSec).toBe(60)
  })

  test("429 with retry-after-ms converts to seconds", () => {
    const refusal = classifyRefusal({ status: 429, headers: { "Retry-After-Ms": "2500" }, body: "" })
    expect(refusal.kind).toBe("rate_limited")
    expect(refusal.retryAfterSec).toBe(3)
  })

  test("auth is never retried blindly", () => {
    for (const status of [401, 403]) {
      expect(classifyRefusal({ status, headers: {}, body: "" }).kind).toBe("auth")
    }
  })

  test("5xx and unreachable are transient", () => {
    expect(classifyRefusal({ status: 503, headers: {}, body: "" }).kind).toBe("transient")
    expect(classifyRefusal({ status: undefined, headers: {}, body: undefined }).kind).toBe("transient")
  })

  test("anything else is unknown", () => {
    expect(classifyRefusal({ status: 400, headers: {}, body: "nope" }).kind).toBe("unknown")
  })
})

describe("manager rotation", () => {
  test("picks first ok source, rotates on refusal, recovers after cooldown", () => {
    const manager = new QuotaManager({ sources: [source("a", 0), source("b", 1)] })
    expect(manager.pick(1000)?.id).toBe("a")
    manager.refuse("a", { status: 429, headers: { "retry-after": "10" }, body: "" }, 1000)
    expect(manager.pick(1000)?.id).toBe("b")
    expect(manager.pick(5000)?.id).toBe("b")
    expect(manager.pick(11_001)?.id).toBe("a")
  })

  test("quota exhausted parks until reset, nextRecoveryMs guides waiting", () => {
    const now = 1_000_000
    const manager = new QuotaManager({ sources: [source("solo", 0)] })
    manager.refuse("solo", { status: 200, headers: {}, body: "FreeUsageLimitError" }, now)
    expect(manager.pick(now)).toBeUndefined()
    const wait = manager.nextRecoveryMs(now)
    expect(wait).toBe(msTillUtcMidnight(now))
    expect(manager.pick(now + (wait ?? 0))?.id).toBe("solo")
  })

  test("success clears the streak", () => {
    const manager = new QuotaManager({ sources: [source("solo", 0)] })
    manager.refuse("solo", { status: 500, headers: {}, body: "" }, 1000)
    manager.succeed("solo")
    expect(manager.pick(1001)?.id).toBe("solo")
    expect(manager.snapshot(1001)[0]?.consecutiveRefusals).toBe(0)
  })

  test("auth parks indefinitely until manual recovery", () => {
    const manager = new QuotaManager({ sources: [source("solo", 0)] })
    manager.refuse("solo", { status: 401, headers: {}, body: "" }, 1000)
    expect(manager.pick(1000 + 365 * 86_400_000)).toBeUndefined()
  })
})

describe("state helpers", () => {
  test("cooldowns expire automatically and success resets", () => {
    const state = initialState("x")
    expect(statusAt(state, 999)).toBe("ok")
    expect(recordSuccess(state).consecutiveRefusals).toBe(0)
  })
})

describe("trust", () => {
  test("verified silent, community once, custom always", () => {
    const base = source("s")
    const seen = new Set<"verified" | "community" | "custom">()
    expect(trustNotices({ ...base, trust: "verified" }, seen)).toEqual([])
    const first = trustNotices({ ...base, trust: "community" }, seen)
    expect(first).toHaveLength(1)
    expect(first[0]?.level).toBe("warn-once")
    seen.add("community")
    expect(trustNotices({ ...base, trust: "community" }, seen)).toEqual([])
    const custom = trustNotices({ ...base, trust: "custom", baseUrl: "https://evil.example" }, seen)
    expect(custom[0]?.level).toBe("confirm-always")
    expect(custom[0]?.message).toContain("https://evil.example")
  })
})

describe("report", () => {
  test("tallies per source with totals", () => {
    const report = new SqueezeReport()
    report.recordRequest("a")
    report.recordSuccess("a")
    report.recordRequest("a")
    report.recordRefusal("a")
    report.recordRequest("b")
    const summary = report.summary()
    expect(summary.totalRequests).toBe(3)
    expect(summary.totalRefusals).toBe(1)
    expect(summary.sources.map((s) => s.sourceId)).toEqual(["a", "b"])
  })
})
