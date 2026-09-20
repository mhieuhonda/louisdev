import { z } from "zod"
import { type Source, SourceSchema } from "./source.ts"

/** Ordered rotation chain. First enabled source (by priority) is tried first. */
export const ChainSchema = z.object({
  sources: z.array(SourceSchema).min(1, "chain needs at least one source"),
})
export type Chain = z.infer<typeof ChainSchema>

/**
 * Default chain shipped with LouisDev. Zero setup: the public-key source
 * works with no account and no key. Everything else is added by the user.
 */
export function defaultChain(): Chain {
  const sources: Source[] = [
    {
      id: "zen-public",
      label: "Zen Public (keyless)",
      baseUrl: "https://opencode.ai/zen/v1",
      protocol: "openai-responses",
      auth: { type: "public", key: "public" },
      // Company-run proxy with opaque limits: usable, but not "verified".
      trust: "community",
      quota: { scope: "ip", reset: "daily-utc" },
      models: ["muse-spark-1.3-contributor-free"],
      catalogUrl: "https://models.opencode.ai/api.json",
      enabled: true,
      priority: 0,
    },
  ]
  return ChainSchema.parse({ sources })
}

/** Sort enabled sources by priority (stable, lower first). */
export function orderedSources(chain: Chain): Source[] {
  return chain.sources.filter((source) => source.enabled).toSorted((a, b) => a.priority - b.priority)
}
