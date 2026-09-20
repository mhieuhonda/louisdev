import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultChain, type TrustTier } from "@louisdev/config"
import { QuotaManager, SqueezeReport } from "@louisdev/quota"
import { type AgentEvent, runTurn } from "../src/loop.ts"
import { SessionStore } from "../src/store.ts"

function chainTwo() {
  const base = defaultChain().sources[0]
  if (!base) throw new Error("empty default chain")
  return {
    sources: [
      { ...base, id: "s1", label: "S1", baseUrl: "http://s1", priority: 0, trust: "verified" as const },
      { ...base, id: "s2", label: "S2", baseUrl: "http://s2", priority: 1, trust: "verified" as const },
    ],
  }
}

function sseText(text: string): string {
  return `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\ndata: [DONE]\n\n`
}

function sseToolCall(id: string, name: string, args: string): string {
  return (
    `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":${JSON.stringify(id)},"function":{"name":${JSON.stringify(name)},"arguments":${JSON.stringify(args.slice(0, 10))}}}]}}]}\n\n` +
    `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":${JSON.stringify(args.slice(10))}}}]}}]}\n\ndata: [DONE]\n\n`
  )
}

function stubFetch(handler: (url: string) => Response): typeof fetch {
  return ((url: string | URL | Request) => Promise.resolve(handler(String(url)))) as typeof fetch
}

describe("loop", () => {
  test("rotates to second source after 429, reports tallies", async () => {
    let s1hits = 0
    const fetchImpl = stubFetch((url) => {
      if (url.startsWith("http://s1")) {
        s1hits += 1
        return new Response("slow", { status: 429, headers: { "retry-after": "60" } })
      }
      return new Response(sseText("hi there"), { headers: { "Content-Type": "text/event-stream" } })
    })
    const store = new SessionStore(":memory:")
    try {
      const manager = new QuotaManager(chainTwo())
      const report = new SqueezeReport()
      const events: AgentEvent[] = []
      const session = store.create()
      const result = await runTurn({
        manager,
        report,
        store,
        sessionId: session.id,
        input: "hello",
        toolCtx: { workdir: tmpdir(), autoApprove: false },
        fetchImpl,
        seenTrust: new Set<TrustTier>(),
        onEvent: (e) => events.push(e),
      })
      expect(result.text).toBe("hi there")
      expect(result.sourcesUsed).toEqual(["s1", "s2"])
      expect(s1hits).toBe(1)
      const summary = report.summary()
      expect(summary.totalRequests).toBe(2)
      expect(summary.totalRefusals).toBe(1)
      expect(events.some((e) => e.type === "text")).toBe(true)
      expect(store.get(session.id)?.messages.length).toBeGreaterThan(1)
    } finally {
      store.close()
    }
  })

  test("executes tool calls and continues", async () => {
    const dir = mkdtempSync(join(tmpdir(), "louisdev-loop-"))
    await Bun.write(join(dir, "note.txt"), "secret-data")
    let calls = 0
    const fetchImpl = stubFetch(() => {
      calls += 1
      if (calls === 1) {
        return new Response(sseToolCall("call_1", "read", '{"path":"note.txt"}'), {
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      return new Response(sseText("got it"), { headers: { "Content-Type": "text/event-stream" } })
    })
    const store = new SessionStore(":memory:")
    try {
      const manager = new QuotaManager(chainTwo())
      const report = new SqueezeReport()
      const session = store.create()
      const result = await runTurn({
        manager,
        report,
        store,
        sessionId: session.id,
        input: "read the note",
        toolCtx: { workdir: dir, autoApprove: true },
        fetchImpl,
      })
      expect(result.text).toBe("got it")
      expect(result.steps).toBe(2)
      const messages = store.get(session.id)?.messages ?? []
      expect(messages.some((m) => m.role === "tool" && m.content.includes("secret-data"))).toBe(true)
    } finally {
      store.close()
    }
  })

  test("waits for recovery when everything cools, then resumes", async () => {
    let hits = 0
    const fetchImpl = stubFetch(() => {
      hits += 1
      if (hits === 1) return new Response("busy", { status: 429 })
      return new Response(sseText("recovered"), { headers: { "Content-Type": "text/event-stream" } })
    })
    const store = new SessionStore(":memory:")
    try {
      const base = defaultChain().sources[0]
      if (!base) throw new Error("empty default chain")
      const manager = new QuotaManager(
        { sources: [{ ...base, id: "solo", baseUrl: "http://solo", trust: "verified" }] },
        { baseCooldownMs: 20, maxCooldownMs: 50 },
      )
      const report = new SqueezeReport()
      const session = store.create()
      const events: AgentEvent[] = []
      const result = await runTurn({
        manager,
        report,
        store,
        sessionId: session.id,
        input: "hi",
        toolCtx: { workdir: tmpdir(), autoApprove: false },
        fetchImpl,
        onEvent: (e) => events.push(e),
      })
      expect(result.text).toBe("recovered")
      expect(events.some((e) => e.type === "waiting")).toBe(true)
    } finally {
      store.close()
    }
  })
})
