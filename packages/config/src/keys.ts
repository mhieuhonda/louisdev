import { z } from "zod"

/**
 * A reference to a secret. The value itself is never stored in config -
 * it is read from the process environment at runtime.
 */
export const KeyRefSchema = z.object({
  /** Environment variable holding the secret, e.g. OPENROUTER_API_KEY. */
  name: z.string().min(1),
})
export type KeyRef = z.infer<typeof KeyRefSchema>

/** Named key references, keyed by an id used in source auth. */
export const KeysSchema = z.record(z.string(), KeyRefSchema)
export type Keys = z.infer<typeof KeysSchema>

/** Read a referenced secret. Returns undefined when not set (never throws). */
export function readKey(ref: KeyRef): string | undefined {
  const value = process.env[ref.name]
  return value && value.length > 0 ? value : undefined
}
