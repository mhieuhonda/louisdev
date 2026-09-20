import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultChain, sunsetFlowDark } from "@louisdev/config"
import type { SourceView } from "@louisdev/quota"
import { formatSourceLine, formatWait, renderQuotaBoard } from "../src/board.ts"
import { plainLogo, renderLogo } from "../src/logo.ts"
import { loadTheme } from "../src/theme.ts"

const theme = sunsetFlowDark()

function view(id: string, status: SourceView["status"], waitMs = 0): SourceView {
  const base = defaultChain().sources[0]
  if (!base) throw new Error("empty default chain")
  return { source: { ...base, id }, status, waitMs, consecutiveRefusals: 0, lastMessage: undefined }
}

describe("logo", () => {
  test("grid is stable: 5 rows, equal widths, 8 letters", () => {
    const lines = plainLogo()
    expect(lines).toHaveLength(5)
    const widths = new Set(lines.map((l) => l.length))
    expect(widths.size).toBe(1)
    expect(lines.join("").replace(/ /g, "").length).toBeGreaterThan(50)
  })

  test("gradient render keeps shape, NO_COLOR stays plain", () => {
    const saved = process.env.NO_COLOR
    delete process.env.NO_COLOR
    try {
      const colored = renderLogo(theme, 80)
      expect(colored).toContain("\u001b[38;2;")
      expect(colored).toContain("free-max coding CLI")
    } finally {
      if (saved !== undefined) process.env.NO_COLOR = saved
    }
    process.env.NO_COLOR = "1"
    try {
      const plain = renderLogo(theme, 80)
      expect(plain).not.toContain("\u001b[")
      expect(plain.split("\n")).toHaveLength(6)
    } finally {
      if (saved === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = saved
    }
  })
})

describe("board", () => {
  test("wait formats grow with scale", () => {
    expect(formatWait(0)).toBe("0s")
    expect(formatWait(45_000)).toBe("45s")
    expect(formatWait(192_000)).toBe("3m12s")
    expect(formatWait(3_900_000)).toBe("1h05m")
    expect(formatWait(200_000_000)).toBe("2d07h")
  })

  test("board shows counts and all-cooling footer", () => {
    const board = renderQuotaBoard(theme, [view("a", "ok"), view("b", "cooling", 65_000)])
    expect(board).toContain("1/2 sources ready")
    expect(board).toContain("1m05s")
    const allDown = renderQuotaBoard(theme, [view("a", "exhausted", 60_000)])
    expect(allDown).toContain("waiting for fastest recovery")
  })

  test("source line carries last message", () => {
    const line = formatSourceLine(theme, { ...view("a", "cooling", 1000), lastMessage: "slow down" })
    expect(line).toContain("slow down")
  })
})

describe("theme loader", () => {
  test("built-ins resolve, unknown rejects, files validate", async () => {
    expect((await loadTheme("sunset-flow")).mode).toBe("dark")
    await expect(loadTheme("nope")).rejects.toThrow("unknown theme")
    const dir = mkdtempSync(join(tmpdir(), "louisdev-theme-"))
    await Bun.write(join(dir, "mine.json"), JSON.stringify(sunsetFlowDark()))
    expect((await loadTheme("mine", dir)).name).toBe("sunset-flow")
    await Bun.write(join(dir, "bad.json"), JSON.stringify({ name: "bad" }))
    await expect(loadTheme("bad", dir)).rejects.toThrow("invalid theme")
  })
})
