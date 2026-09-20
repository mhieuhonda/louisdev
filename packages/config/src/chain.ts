import { z } from "zod"
import { type Source, SourceSchema } from "./source.ts"

/** Ordered rotation chain. First enabled source (by priority) is tried first. */
export const ChainSchema = z.object({
  sources: z.array(SourceSchema).min(1, "chain needs at least one source"),
})
export type Chain = z.infer<typeof ChainSchema>

/**
 * Default chain shipped with LouisDev. Zero setup: the first source needs
 * no account and no key. Everything else is added by the user.
 *
 * Note: the opencode zen endpoint was evaluated and rejected as a default
 * source - its free tier is server-gated to genuine OpenCode clients
 * (HTTP 403 FreeTierError for third parties, verified live). Keyless
 * rotation starts at Pollinations instead.
 */
export function defaultChain(): Chain {
  const sources: Source[] = [
    {
      id: "pollinations-public",
      label: "Pollinations Public (keyless)",
      baseUrl: "https://text.pollinations.ai/openai",
      protocol: "openai-chat",
      auth: { type: "none" },
      // Community-run public API with opaque limits: usable, warn once.
      trust: "community",
      quota: { scope: "ip", reset: "unknown" },
      models: ["openai"],
      enabled: true,
      priority: 0,
    },
    {
      id: "openrouter-free",
      label: "OpenRouter Free Models (free key)",
      baseUrl: "https://openrouter.ai/api/v1",
      protocol: "openai-chat",
      auth: { type: "env", var: "OPENROUTER_API_KEY" },
      // Official public API with published docs and limits.
      trust: "verified",
      quota: { scope: "key", reset: "rolling" },
      models: [],
      catalogUrl: "https://openrouter.ai/api/v1/models",
      enabled: true,
      priority: 10,
    },
  ]
  return ChainSchema.parse({ sources })
}

/** Sort enabled sources by priority (stable, lower first). */
export function orderedSources(chain: Chain): Source[] {
  return chain.sources.filter((source) => source.enabled).toSorted((a, b) => a.priority - b.priority)
}
