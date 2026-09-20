import { describe, expect, test } from "bun:test"
import { freeModels, loadCatalog, parseCatalog } from "../src/catalog.ts"

const RAW = {
  zen: {
    models: {
      "spark-free": { cost: { input: 0, output: 0 }, limit: { context: 1000, output: 100 } },
      "pro-paid": { cost: { input: 5, output: 10 }, limit: { context: 2000 } },
      broken: "not-an-object",
    },
  },
  empty: {},
  nonsense: "nope",
}

describe("catalog", () => {
  test("parses, filters free, keeps limits", () => {
    const models = parseCatalog(RAW as unknown as Record<string, unknown>)
    expect(models).toHaveLength(2)
    const free = freeModels(models)
    expect(free.map((m) => m.id)).toEqual(["spark-free"])
    expect(free[0]?.contextLimit).toBe(1000)
    expect(free[0]?.outputLimit).toBe(100)
  })

  test("reads fresh cache without network", async () => {
    const path = `${import.meta.dir}/fixture-catalog.json`
    await Bun.write(path, JSON.stringify(RAW))
    try {
      const models = await loadCatalog("https://unreachable.invalid/api.json", path, 60_000)
      expect(models).toHaveLength(2)
    } finally {
      const { unlink } = await import("node:fs/promises")
      await unlink(path).catch(() => undefined)
    }
  })

  test("stale cache triggers fetch and fails cleanly offline", async () => {
    const path = `${import.meta.dir}/fixture-stale.json`
    await Bun.write(path, JSON.stringify(RAW))
    try {
      // Make the cache look old by backdating through a fresh fetch failure.
      await expect(loadCatalog("https://unreachable.invalid/api.json", path, -1)).rejects.toThrow("catalog")
    } finally {
      const { unlink } = await import("node:fs/promises")
      await unlink(path).catch(() => undefined)
    }
  })
})
