import { builtinThemes, type Theme, ThemeSchema } from "@louisdev/config"

export class ThemeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ThemeError"
  }
}

/**
 * Resolve a theme by name: built-ins first, then JSON files in `dir`.
 * User files are validated against the same schema as built-ins.
 */
export async function loadTheme(name: string, dir?: string): Promise<Theme> {
  const builtin = builtinThemes().find((theme) => theme.name === name)
  if (builtin) return builtin
  if (!dir) throw new ThemeError(`unknown theme: ${name}`)
  const file = Bun.file(`${dir.replace(/\/$/, "")}/${name}.json`)
  if (!(await file.exists())) throw new ThemeError(`unknown theme: ${name}`)
  const text = await file.text().catch(() => undefined)
  if (text === undefined) throw new ThemeError(`cannot read theme file: ${name}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new ThemeError(`theme file is not valid JSON: ${name}`)
  }
  const result = ThemeSchema.safeParse(parsed)
  if (!result.success)
    throw new ThemeError(`invalid theme ${name}: ${result.error.issues[0]?.message ?? "schema mismatch"}`)
  return result.data
}
