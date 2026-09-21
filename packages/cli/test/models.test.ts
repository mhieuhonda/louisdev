import { describe, expect, test } from "bun:test"
import { defaultChain } from "@louisdev/config"
import { listModelEntries, parseSelection } from "../src/models.ts"

function entries() {
  return [
    { sourceId: "a", sourceLabel: "A (keyless)", model: "m1", needsKey: false },
    { sourceId: "b", sourceLabel: "B (free key)", model: "m2", needsKey: true, keyVar: "B_KEY" },
    { sourceId: "b", sourceLabel: "B (free key)", model: "m3", needsKey: true, keyVar: "B_KEY" },
  ]
}

describe("models", () => {
  test("parseSelection resolves numbers, cancels, rejects junk", () => {
    const list = entries()
    const pick = parseSelection("2", list)
    expect(pick.type).toBe("pick")
    if (pick.type === "pick") {
      expect(pick.entry.model).toBe("m2")
      expect(pick.number).toBe(2)
    }
    expect(parseSelection("", list).type).toBe("cancel")
    expect(parseSelection("99", list).type).toBe("invalid")
    expect(parseSelection("abc", list).type).toBe("invalid")
  })

  test("listModelEntries orders keyless first and keeps key providers visible", async () => {
    const list = await listModelEntries(defaultChain())
    expect(list[0]?.sourceId).toBe("pollinations-public")
    expect(list[0]?.needsKey).toBe(false)
    expect(list.some((entry) => entry.sourceId === "openrouter-free")).toBe(true)
    expect(list.some((entry) => entry.sourceId === "opencode-zen")).toBe(true)
    // Key-required entries carry their env var for the key prompt.
    const zen = list.find((entry) => entry.sourceId === "opencode-zen")
    expect(zen?.keyVar).toBe("OPENCODE_API_KEY")
  })
})
