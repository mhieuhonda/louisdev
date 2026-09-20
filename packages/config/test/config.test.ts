import { describe, expect, test } from "bun:test"
import { unlink } from "node:fs/promises"
import {
  AuthSchema,
  builtinThemes,
  ChainSchema,
  ConfigSchema,
  defaultChain,
  loadConfig,
  orderedSources,
  SourceSchema,
  sunsetFlowDark,
  sunsetFlowLight,
  ThemeSchema,
} from "../src/index.ts"

describe("source", () => {
  test("rejects bad id, url, and unknown trust", () => {
    const base = {
      id: "zen-public",
      label: "Zen",
      baseUrl: "https://opencode.ai/zen/v1",
      protocol: "openai-responses",
      auth: { type: "public" },
      trust: "community",
    }
    expect(() => SourceSchema.parse({ ...base, id: "Bad_ID!" })).toThrow()
    expect(() => SourceSchema.parse({ ...base, baseUrl: "not-a-url" })).toThrow()
    expect(() => SourceSchema.parse({ ...base, trust: "vip" })).toThrow()
    expect(SourceSchema.parse(base).auth).toEqual({ type: "public", key: "public" })
  })

  test("auth variants parse", () => {
    expect(AuthSchema.parse({ type: "none" })).toEqual({ type: "none" })
    const envAuth = AuthSchema.parse({ type: "env", var: "OPENROUTER_API_KEY" })
    expect(envAuth.type).toBe("env")
    if (envAuth.type === "env") expect(envAuth.var).toBe("OPENROUTER_API_KEY")
    expect(() => AuthSchema.parse({ type: "env" })).toThrow()
    expect(() => AuthSchema.parse({ type: "token", value: "secret" })).toThrow()
  })
})

describe("chain", () => {
  test("default chain is valid with zen-public first", () => {
    const chain = defaultChain()
    expect(ChainSchema.parse(chain).sources).toHaveLength(1)
    expect(orderedSources(chain)[0]?.id).toBe("zen-public")
  })

  test("ordering is stable by priority, disabled skipped", () => {
    const chain = ChainSchema.parse({
      sources: [
        { ...defaultChain().sources[0], id: "b", priority: 5 },
        { ...defaultChain().sources[0], id: "a", priority: 5 },
        { ...defaultChain().sources[0], id: "off", priority: 0, enabled: false },
      ],
    })
    expect(orderedSources(chain).map((s) => s.id)).toEqual(["b", "a"])
  })

  test("empty chain rejected", () => {
    expect(() => ChainSchema.parse({ sources: [] })).toThrow()
  })
})

describe("theme", () => {
  test("built-ins are valid and distinct modes", () => {
    expect(builtinThemes()).toHaveLength(2)
    for (const theme of builtinThemes()) expect(() => ThemeSchema.parse(theme)).not.toThrow()
    expect(sunsetFlowDark().mode).toBe("dark")
    expect(sunsetFlowLight().mode).toBe("light")
  })

  test("rejects non-hex colors", () => {
    const dark = sunsetFlowDark()
    expect(() => ThemeSchema.parse({ ...dark, tokens: { ...dark.tokens, primary: "coral" } })).toThrow()
  })
})

describe("config", () => {
  test("defaults apply with no input", async () => {
    const config = await loadConfig()
    expect(config.version).toBe(1)
    expect(config.theme).toBe("sunset-flow")
    expect(config.chain.sources[0]?.id).toBe("zen-public")
    expect(config.keys).toEqual({})
  })

  test("flags beat env beat file", async () => {
    const path = `${import.meta.dir}/fixture-config.json`
    await Bun.write(path, JSON.stringify({ theme: "from-file" }))
    process.env.LOUISDEV_CONFIG = path
    process.env.LOUISDEV_THEME = "from-env"
    try {
      expect((await loadConfig()).theme).toBe("from-env")
      expect((await loadConfig({ theme: "from-flags" })).theme).toBe("from-flags")
    } finally {
      delete process.env.LOUISDEV_CONFIG
      delete process.env.LOUISDEV_THEME
      await unlink(path).catch(() => undefined)
    }
  })

  test("invalid file content throws ConfigError", async () => {
    const path = `${import.meta.dir}/fixture-bad.json`
    await Bun.write(path, JSON.stringify({ chain: { sources: [] } }))
    try {
      await expect(loadConfig({ configPath: path })).rejects.toThrow("chain")
    } finally {
      await unlink(path).catch(() => undefined)
    }
  })

  test("root schema has safe defaults", () => {
    const config = ConfigSchema.parse({})
    expect(config.catalog.ttlMinutes).toBe(5)
  })
})
