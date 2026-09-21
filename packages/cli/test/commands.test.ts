import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { type RunContext, run } from "../src/commands.ts"

function ctx(
  overrides: Partial<RunContext> = {},
): RunContext & { outText: () => string; errText: () => string } {
  let out = ""
  let err = ""
  const base: RunContext = {
    out: (t) => {
      out += t
    },
    err: (t) => {
      err += t
    },
    sessionDb: join(mkdtempSync(join(tmpdir(), "louisdev-cli-")), "sessions.db"),
    ...overrides,
  }
  return { ...base, outText: () => out, errText: () => err }
}

function stubFetch(body: string): typeof fetch {
  const impl = (_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response(body, { headers: { "Content-Type": "text/event-stream" } }))
  return impl as unknown as typeof fetch
}

describe("commands", () => {
  test("version and help", async () => {
    const v = ctx()
    expect(await run(["version"], v)).toBe(0)
    expect(v.outText()).toContain("louisdev 0.0.1")
    const h = ctx()
    expect(await run(["help"], h)).toBe(0)
    expect(h.outText()).toContain("louisdev chat")
  })

  test("chain lists default sources", async () => {
    const c = ctx()
    expect(await run(["chain"], c)).toBe(0)
    expect(c.outText()).toContain("pollinations-public")
    expect(c.outText()).toContain("openrouter-free")
  })

  test("quota shows board", async () => {
    const c = ctx()
    expect(await run(["quota"], c)).toBe(0)
    expect(c.outText()).toContain("4/4 sources ready")
  })

  test("chat runs end to end on stubbed source", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"stubbed hi"}}]}\n\ndata: [DONE]\n\n'
    const sessionDb = join(mkdtempSync(join(tmpdir(), "louisdev-cli-")), "sessions.db")
    const c = ctx({ fetchImpl: stubFetch(sse), sessionDb })
    const code = await run(["chat", "hello"], c)
    expect(code).toBe(0)
    expect(c.outText()).toContain("stubbed hi")
    expect(c.outText()).toContain("free-max coding CLI")
    expect(c.errText()).toContain("1 request(s), 0 refusal(s)")
    // session persisted - list it via a fresh context sharing the db
    const list = ctx({ sessionDb })
    expect(await run(["sessions"], list)).toBe(0)
    expect(list.outText()).toContain("ses_")
  })

  test("chat without message opens interactive, exits on closed stdin", async () => {
    const closed = new PassThrough()
    closed.end()
    const c = ctx({ stdin: closed as unknown as NodeJS.ReadStream })
    expect(await run(["chat"], c)).toBe(0)
    expect(c.outText()).toContain("free-max coding CLI")
    expect(c.outText()).toContain("bye")
  })

  test("interactive chat runs a turn and leaves on /exit", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"chat reply"}}]}\n\ndata: [DONE]\n\n'
    const script = new PassThrough()
    const c = ctx({ fetchImpl: stubFetch(sse), stdin: script as unknown as NodeJS.ReadStream })
    script.write("hello there\n")
    const done = run(["chat"], c).then((code) => {
      expect(code).toBe(0)
      expect(c.outText()).toContain("chat reply")
      expect(c.outText()).toContain("bye")
      return true
    })
    // Wait for the turn to finish, then exit while the next prompt is open.
    for (let i = 0; i < 100 && !c.errText().includes("1 request(s)"); i += 1) await Bun.sleep(20)
    script.write("/exit\n")
    expect(await done).toBe(true)
  })

  test("interactive /models lists keyless first, cancel works", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "louisdev-cache-"))
    await Bun.write(
      join(cacheDir, "openrouter-free-models.json"),
      JSON.stringify({
        data: [{ id: "test/free-model", pricing: { prompt: "0", completion: "0" }, context_length: 8000 }],
      }),
    )
    process.env.LOUISDEV_CACHE_DIR = cacheDir
    try {
      const script = new PassThrough()
      const c = ctx({ stdin: script as unknown as NodeJS.ReadStream })
      script.write("/models\n")
      const done = run(["chat"], c).then((code) => {
        expect(code).toBe(0)
        expect(c.outText()).toContain("Pollinations (keyless) — openai")
        expect(c.outText()).toContain("test/free-model")
        expect(c.outText()).toContain("bye")
        return true
      })
      // Wait for the select prompt, cancel with an empty line, then leave.
      for (let i = 0; i < 100 && !c.errText().includes("select › "); i += 1) await Bun.sleep(20)
      script.write("\n")
      await Bun.sleep(80)
      script.write("/exit\n")
      expect(await done).toBe(true)
    } finally {
      delete process.env.LOUISDEV_CACHE_DIR
    }
  })

  test("unknown command exits 2", async () => {
    const c = ctx()
    expect(await run(["nope"], c)).toBe(2)
  })
})
