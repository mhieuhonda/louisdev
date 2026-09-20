import { z } from "zod"
import { ChainSchema, defaultChain } from "./chain.ts"
import { KeysSchema } from "./keys.ts"

/** Root LouisDev configuration. Precedence: flags > env > file > defaults. */
export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  chain: ChainSchema.prefault(() => defaultChain()),
  /** Active theme name (built-in or user-provided JSON theme). */
  theme: z.string().min(1).default("sunset-flow"),
  keys: KeysSchema.default({}),
  catalog: z
    .object({
      url: z.string().url().default("https://models.opencode.ai/api.json"),
      ttlMinutes: z.number().int().min(1).max(1440).default(5),
    })
    .prefault({}),
})
export type LouisDevConfig = z.infer<typeof ConfigSchema>

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

/** Partial overrides coming from CLI flags. */
export const FlagsSchema = z.object({
  configPath: z.string().min(1).optional(),
  theme: z.string().min(1).optional(),
  catalogUrl: z.string().url().optional(),
})
export type ConfigFlags = z.infer<typeof FlagsSchema>

const ENV_CONFIG = "LOUISDEV_CONFIG"
const ENV_THEME = "LOUISDEV_THEME"
const ENV_CATALOG_URL = "LOUISDEV_CATALOG_URL"

/** Read and validate the JSON config file. Returns undefined when absent. */
async function readFile(path: string | undefined): Promise<unknown> {
  if (!path) return undefined
  const file = Bun.file(path)
  const exists = await file.exists()
  if (!exists) return undefined
  const text = await file.text().catch(() => undefined)
  if (text === undefined) throw new ConfigError(`cannot read config file: ${path}`)
  const parsed: unknown = JSON.parse(text) as unknown
  return parsed
}

/**
 * Load configuration with precedence flags > env > file > defaults.
 * Never throws for a missing file - defaults apply.
 */
export async function loadConfig(flags: ConfigFlags = {}): Promise<LouisDevConfig> {
  const parsedFlags = FlagsSchema.parse(flags)
  const filePath = parsedFlags.configPath ?? process.env[ENV_CONFIG]
  const raw = await readFile(filePath)
  const base = raw === undefined ? {} : raw
  const merged = {
    ...(typeof base === "object" && base !== null ? base : {}),
    ...(process.env[ENV_THEME] ? { theme: process.env[ENV_THEME] } : {}),
    ...(process.env[ENV_CATALOG_URL] ? { catalog: { url: process.env[ENV_CATALOG_URL] } } : {}),
    ...(parsedFlags.theme ? { theme: parsedFlags.theme } : {}),
    ...(parsedFlags.catalogUrl ? { catalog: { url: parsedFlags.catalogUrl } } : {}),
  }
  const result = ConfigSchema.safeParse(merged)
  if (!result.success) throw new ConfigError(z.prettifyError(result.error))
  return result.data
}
