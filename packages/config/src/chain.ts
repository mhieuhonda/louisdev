import { z } from "zod"
import { type Source, SourceSchema } from "./source.ts"

/** Ordered rotation chain. First enabled source (by priority) is tried first. */
export const ChainSchema = z.object({
  sources: z.array(SourceSchema).min(1, "chain needs at least one source"),
})
export type Chain = z.infer<typeof ChainSchema>

/**
 * Default chain shipped with LouisDev. Zero setup: the first source needs
 * no account and no key. Everything else is optional - keys entered through
 * the chat (/models picker) are persisted to the local key store.
 *
 * Note: the opencode zen endpoint is offered as an optional source for users
 * who own an OpenCode key. Its FREE tier is server-gated to genuine OpenCode
 * clients (HTTP 403 FreeTierError for third parties, verified live), so it is
 * never the default. Keyless rotation starts at Pollinations instead.
 */
export function defaultChain(): Chain {
  const sources: Source[] = [
    {
      id: "pollinations-public",
      label: "Pollinations (keyless)",
      baseUrl: "https://text.pollinations.ai/openai",
      protocol: "openai-chat",
      auth: { type: "none" },
      // Community-run public API with opaque limits: usable, warn once.
      trust: "community",
      quota: { scope: "ip", reset: "unknown" },
      models: ["openai"],
      // Reasoning models otherwise think ~9x longer before the first token.
      reasoningEffort: "low",
      enabled: true,
      priority: 0,
    },
    {
      id: "openrouter-free",
      label: "OpenRouter Free (free key)",
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
    {
      id: "nvidia-nim",
      label: "NVIDIA NIM Free (free key)",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      protocol: "openai-chat",
      auth: { type: "env", var: "NVIDIA_API_KEY" },
      // Free-tier preview endpoints, 40+ models, published docs.
      trust: "verified",
      quota: { scope: "key", reset: "unknown" },
      models: [
        "meta/llama-4-maverick-17b-128e-instruct",
        "qwen/qwen3-coder-480b-a35b-instruct",
        "mistralai/mistral-nemotron",
        "bytedance/seed-oss-36b-instruct",
      ],
      enabled: true,
      priority: 15,
    },
    {
      id: "opencode-zen",
      label: "OpenCode Zen (key)",
      baseUrl: "https://opencode.ai/zen/v1",
      protocol: "openai-chat",
      auth: { type: "env", var: "OPENCODE_API_KEY" },
      // Optional: key holders get muse-spark and friends. Free tier is
      // server-gated to OpenCode clients, so this never rotates by default.
      trust: "verified",
      quota: { scope: "key", reset: "unknown" },
      models: ["muse-spark-1.3-contributor-free", "muse-spark-1.2-contributor-free"],
      enabled: true,
      priority: 20,
    },
  ]
  return ChainSchema.parse({ sources })
}

/** Sort enabled sources by priority (stable, lower first). */
export function orderedSources(chain: Chain): Source[] {
  return chain.sources.filter((source) => source.enabled).toSorted((a, b) => a.priority - b.priority)
}
