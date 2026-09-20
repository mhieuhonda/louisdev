import { afterEach, describe, expect, test } from "bun:test"
import type { Source } from "@louisdev/config"
import { ProviderRequestError, sendChat } from "../src/sender.ts"

let server: ReturnType<typeof Bun.serve> | undefined
afterEach(() => {
  server?.stop(true)
  server = undefined
})

function baseSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "stub",
    label: "Stub",
    baseUrl: "http://127.0.0.1:1",
    protocol: "openai-chat",
    auth: { type: "public", key: "public" },
    trust: "verified",
    quota: { scope: "ip", reset: "unknown" },
    models: [],
    enabled: true,
    priority: 0,
    ...overrides,
  }
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let text = ""
  for await (const delta of gen) text += delta
  return text
}

describe("sender", () => {
  test("public auth sends apiKey in body, streams chat deltas", async () => {
    let seenBody: Record<string, unknown> = {}
    let seenAuth: string | null = "missing"
    server = Bun.serve({
      port: 0,
      fetch(request) {
        seenAuth = request.headers.get("authorization")
        return request.json().then((body) => {
          seenBody = body as Record<string, unknown>
          return new Response(
            'data: {"choices":[{"delta":{"content":"hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
            { headers: { "Content-Type": "text/event-stream" } },
          )
        })
      },
    })
    const source = baseSource({ baseUrl: `http://127.0.0.1:${server.port}` })
    const text = await collect(
      sendChat({ source, model: "free-model", messages: [{ role: "user", content: "hi" }] }),
    )
    expect(text).toBe("hello")
    expect(seenBody["apiKey"]).toBe("public")
    expect(seenBody["model"]).toBe("free-model")
    expect(seenAuth).toBeNull()
  })

  test("env auth sends bearer, responses protocol parses output deltas", async () => {
    process.env.LOUISDEV_TEST_KEY = "secret-123"
    try {
      server = Bun.serve({
        port: 0,
        fetch(request) {
          if (request.headers.get("authorization") !== "Bearer secret-123") {
            return new Response("nope", { status: 401 })
          }
          return new Response(
            'data: {"type":"response.output_text.delta","delta":"yo"}\n\ndata: {"type":"response.completed"}\n\n',
            { headers: { "Content-Type": "text/event-stream" } },
          )
        },
      })
      const source = baseSource({
        baseUrl: `http://127.0.0.1:${server.port}`,
        protocol: "openai-responses",
        auth: { type: "env", var: "LOUISDEV_TEST_KEY" },
      })
      const text = await collect(
        sendChat({ source, model: "m", messages: [{ role: "user", content: "hi" }] }),
      )
      expect(text).toBe("yo")
    } finally {
      delete process.env.LOUISDEV_TEST_KEY
    }
  })

  test("refusal carries status, headers, and body for the quota layer", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("FreeUsageLimitError", { status: 429, headers: { "retry-after": "30" } })
      },
    })
    const source = baseSource({ baseUrl: `http://127.0.0.1:${server.port}` })
    const error = await collect(sendChat({ source, model: "m", messages: [] })).then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ProviderRequestError)
    const refusal = error as ProviderRequestError
    expect(refusal.status).toBe(429)
    expect(refusal.headers["retry-after"]).toBe("30")
    expect(refusal.body).toContain("FreeUsageLimitError")
  })

  test("missing env secret fails fast with a clear message", async () => {
    const source = baseSource({ auth: { type: "env", var: "LOUISDEV_DEFINITELY_MISSING" } })
    await expect(collect(sendChat({ source, model: "m", messages: [] }))).rejects.toThrow(
      "LOUISDEV_DEFINITELY_MISSING",
    )
  })

  test("unsupported protocol is explicit", async () => {
    const source = baseSource({ protocol: "gemini" })
    await expect(collect(sendChat({ source, model: "m", messages: [] }))).rejects.toThrow("not supported yet")
  })
})
