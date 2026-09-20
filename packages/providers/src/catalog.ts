export interface ModelCost {
  input: number
  output: number
}

export interface CatalogModel {
  provider: string
  id: string
  cost: ModelCost
  contextLimit: number | undefined
  outputLimit: number | undefined
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CatalogError"
  }
}

const USER_AGENT = "louisdev/0.0.1 (+https://github.com/mhieuhonda/louisdev)"

/** Fetch the public model catalog. No auth required. */
export async function fetchCatalog(url: string, timeoutMs = 10_000): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => undefined)
  if (!response) throw new CatalogError(`catalog unreachable: ${url}`)
  if (!response.ok) throw new CatalogError(`catalog request failed (HTTP ${response.status}): ${url}`)
  const text = await response.text().catch(() => undefined)
  if (text === undefined) throw new CatalogError(`catalog body unreadable: ${url}`)
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new CatalogError(`catalog is not valid JSON: ${url}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Flatten the catalog JSON into model entries. Pure - fully testable. */
export function parseCatalog(raw: Record<string, unknown>): CatalogModel[] {
  const out: CatalogModel[] = []
  for (const [provider, info] of Object.entries(raw)) {
    if (!isRecord(info)) continue
    const models = info.models
    if (!isRecord(models)) continue
    for (const [id, entry] of Object.entries(models)) {
      if (!isRecord(entry)) continue
      const cost = isRecord(entry.cost) ? entry.cost : {}
      const limit = isRecord(entry.limit) ? entry.limit : {}
      out.push({
        provider,
        id,
        cost: { input: num(cost.input) ?? -1, output: num(cost.output) ?? -1 },
        contextLimit: num(limit.context),
        outputLimit: num(limit.output),
      })
    }
  }
  return out
}

/** Models that cost exactly zero in both directions. */
export function freeModels(models: CatalogModel[]): CatalogModel[] {
  return models.filter((model) => model.cost.input === 0 && model.cost.output === 0)
}

/** Read-through disk cache: fresh cache wins, otherwise fetch and store. */
export async function loadCatalog(url: string, cachePath: string, ttlMs: number): Promise<CatalogModel[]> {
  const file = Bun.file(cachePath)
  if (await file.exists()) {
    const stat = await file.stat().catch(() => undefined)
    const mtime = stat?.mtime?.getTime() ?? 0
    if (Date.now() - mtime < ttlMs) {
      const text = await file.text().catch(() => undefined)
      if (text !== undefined) {
        try {
          return parseCatalog(JSON.parse(text) as Record<string, unknown>)
        } catch {
          await file.write("").catch(() => undefined)
        }
      }
    }
  }
  const raw = await fetchCatalog(url)
  await Bun.write(cachePath, JSON.stringify(raw)).catch(() => undefined)
  return parseCatalog(raw)
}
