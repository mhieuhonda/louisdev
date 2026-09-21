import { homedir } from "node:os"
import { join } from "node:path"
import { type Chain, orderedSources, readKey, type Source } from "@louisdev/config"
import { freeModels, loadCatalog } from "@louisdev/providers"

export interface ModelEntry {
  sourceId: string
  sourceLabel: string
  model: string
  /** Key-required sources need a key before their models can answer. */
  needsKey: boolean
  keyVar?: string
}

const DISCOVER_LIMIT = 8

function catalogCachePath(sourceId: string): string {
  if (process.env.LOUISDEV_CACHE_DIR) return join(process.env.LOUISDEV_CACHE_DIR, `${sourceId}-models.json`)
  return join(homedir(), ".cache", "louisdev", `${sourceId}-models.json`)
}

/** Free models discovered from a source's public catalog (network, cached). */
async function discoverModels(source: Source): Promise<string[]> {
  if (!source.catalogUrl) return []
  const catalog = await loadCatalog(source.catalogUrl, catalogCachePath(source.id), 5 * 60_000)
  return freeModels(catalog)
    .slice(0, DISCOVER_LIMIT)
    .map((model) => model.id)
}

/**
 * Build the /models list: keyless sources first (priority order), then key
 * sources. Sources with empty `models` discover free models from their
 * public catalog. Key state is read live, so freshly entered keys unlock
 * their provider without a restart.
 */
export async function listModelEntries(chain: Chain): Promise<ModelEntry[]> {
  const entries: ModelEntry[] = []
  for (const source of orderedSources(chain)) {
    const needsKey = source.auth.type !== "none"
    const keyVar = source.auth.type === "env" ? source.auth.var : undefined
    let models = source.models
    if (models.length === 0 && source.catalogUrl) {
      models = await discoverModels(source).catch(() => [])
    }
    if (models.length === 0 && needsKey) {
      // Keep the provider visible even when nothing is discoverable yet.
      models = ["(no models listed)"]
    }
    for (const model of models) {
      entries.push({ sourceId: source.id, sourceLabel: source.label, model, needsKey, keyVar })
    }
  }
  return entries
}

export type Selection =
  | { type: "pick"; entry: ModelEntry; number: number }
  | { type: "cancel" }
  | { type: "invalid"; input: string }

/** Resolve a typed selection against the listed entries. */
export function parseSelection(input: string, entries: ModelEntry[]): Selection {
  const trimmed = input.trim()
  if (trimmed === "") return { type: "cancel" }
  const number = Number.parseInt(trimmed, 10)
  if (Number.isNaN(number) || number < 1 || number > entries.length)
    return { type: "invalid", input: trimmed }
  const entry = entries[number - 1]
  if (!entry) return { type: "invalid", input: trimmed }
  return { type: "pick", entry, number }
}

/** Whether the entry can answer right now (key present when needed). */
export function entryReady(entry: ModelEntry): boolean {
  if (!entry.needsKey) return true
  if (!entry.keyVar) return false
  return readKey({ name: entry.keyVar }) !== undefined
}
