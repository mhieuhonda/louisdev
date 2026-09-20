import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SessionStore } from "@louisdev/agent"
import type { Theme } from "@louisdev/config"
import { createApp, renderPage } from "../src/index.ts"

function deps(): { sessionDb: string } {
  return { sessionDb: join(mkdtempSync(join(tmpdir(), "louisdev-dash-")), "sessions.db") }
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe("dashboard", () => {
  test("api endpoints return json", async () => {
    const app = createApp(deps())
    const version = await json<{ name: string; version: string }>(await app.request("/api/version"))
    expect(version.name).toBe("louisdev")
    const quota = await json<{ ready: number; total: number; sources: { id: string; wait: string }[] }>(
      await app.request("/api/quota"),
    )
    expect(quota.total).toBeGreaterThanOrEqual(2)
    expect(quota.sources[0]?.wait).toMatch(/\d+(m\d+s)?s/)
    const chain = await json<{ sources: { id: string; priority: number }[] }>(await app.request("/api/chain"))
    expect(chain.sources.map((s) => s.id)).toContain("pollinations-public")
    expect(chain.sources[0]?.priority).toBeLessThanOrEqual(chain.sources[1]?.priority ?? 0)
  })

  test("sessions endpoint lists created sessions", async () => {
    const d = deps()
    const store = new SessionStore(d.sessionDb)
    try {
      store.create("my task")
    } finally {
      store.close()
    }
    const app = createApp(d)
    const { sessions } = await json<{ sessions: { title: string }[] }>(await app.request("/api/sessions"))
    expect(sessions.map((s) => s.title)).toContain("my task")
  })

  test("page renders with theme tokens", () => {
    const tokens = {
      primary: "#e07856",
      secondary: "#2dd4bf",
      accent: "#facc15",
      text: "#f5efe8",
      textMuted: "#a89c90",
      background: "#100d0b",
      backgroundPanel: "#1a1512",
      backgroundElement: "#241d18",
      border: "#33281f",
      success: "#4ade80",
      warning: "#facc15",
      error: "#f87171",
    }
    const theme = { name: "sunset-flow", mode: "dark", tokens } as Theme
    const html = renderPage(theme)
    expect(html).toContain("--primary: #e07856")
    expect(html).toContain("Quota board")
    expect(html).toContain("/api/quota")
  })
})
