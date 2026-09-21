import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"

/**
 * A reference to a secret. The value itself is never stored in config -
 * it is read from the environment or the local key store at runtime.
 */
export const KeyRefSchema = z.object({
  /** Environment variable holding the secret, e.g. OPENROUTER_API_KEY. */
  name: z.string().min(1),
})
export type KeyRef = z.infer<typeof KeyRefSchema>

/** Named key references, keyed by an id used in source auth. */
export const KeysSchema = z.record(z.string(), KeyRefSchema)
export type Keys = z.infer<typeof KeysSchema>

function keysFile(): string {
  if (process.env.LOUISDEV_KEYS_FILE) return process.env.LOUISDEV_KEYS_FILE
  return join(homedir(), ".local", "share", "louisdev", "keys.json")
}

/** Keys entered through the chat, persisted locally: { NAME: value }. */
const StoredKeysSchema = z.record(z.string(), z.string().min(1))

function readStoredKeys(): Record<string, string> {
  const file = keysFile()
  if (!existsSync(file)) return {}
  const text = readFileSync(file, "utf8")
  const parsed = StoredKeysSchema.safeParse(JSON.parse(text))
  return parsed.success ? parsed.data : {}
}

/**
 * Read a referenced secret: env first, then keys entered in the chat.
 * Returns undefined when not set (never throws).
 */
export function readKey(ref: KeyRef): string | undefined {
  const env = process.env[ref.name]
  if (env && env.length > 0) return env
  return readStoredKeys()[ref.name]
}

/** Persist a key entered through the chat as the user's default for that provider. */
export function saveKey(name: string, value: string): void {
  const file = keysFile()
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  const keys = readStoredKeys()
  keys[name] = value
  writeFileSync(file, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 })
}
