import { z } from "zod"

/**
 * How much LouisDev trusts a source. Controls warnings, never capabilities.
 * - verified: official public API with public docs (runs silently)
 * - community: company/community-run proxy, usable but limits may be opaque
 *   (warn once per session)
 * - custom: user-added endpoint (red warning + explicit confirmation,
 *   secrets are never sent automatically)
 */
export const TrustTierSchema = z.enum(["verified", "community", "custom"])
export type TrustTier = z.infer<typeof TrustTierSchema>

/** Wire protocol used to talk to a source. */
export const ProtocolSchema = z.enum(["openai-chat", "openai-responses", "anthropic-messages", "gemini"])
export type Protocol = z.infer<typeof ProtocolSchema>

/**
 * How LouisDev authenticates to a source. Raw secret values are never
 * stored in config - key-based auth only references environment variables.
 */
export const AuthSchema = z.discriminatedUnion("type", [
  /** Truly keyless endpoint (no key sent at all). */
  z.object({ type: z.literal("none") }),
  /** Public-key flow: a well-known non-secret key (e.g. "public"). */
  z.object({
    type: z.literal("public"),
    key: z.string().min(1).default("public"),
  }),
  /** Private key read from an environment variable at runtime. */
  z.object({
    type: z.literal("env"),
    var: z.string().min(1),
  }),
])
export type Auth = z.infer<typeof AuthSchema>

/** Who owns the quota counter: the machine IP or an API key. */
export const QuotaScopeSchema = z.enum(["ip", "key"])
export type QuotaScope = z.infer<typeof QuotaScopeSchema>

/** When a refused source is expected to recover. */
export const QuotaResetSchema = z.enum(["daily-utc", "rolling", "unknown"])
export type QuotaReset = z.infer<typeof QuotaResetSchema>

export const QuotaPolicySchema = z.object({
  scope: QuotaScopeSchema,
  reset: QuotaResetSchema.default("unknown"),
})
export type QuotaPolicy = z.infer<typeof QuotaPolicySchema>

/** One callable free source in the rotation chain. */
export const SourceSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "source id must be lowercase alphanumeric with hyphens"),
  label: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  protocol: ProtocolSchema,
  auth: AuthSchema,
  trust: TrustTierSchema,
  quota: QuotaPolicySchema.default({ scope: "ip", reset: "unknown" }),
  /** Preferred free model ids. Empty means "discover from catalog". */
  models: z.array(z.string().min(1)).default([]),
  /** Public model catalog for this source, if any. */
  catalogUrl: z.string().url().optional(),
  /** Reasoning effort sent to reasoning models, e.g. "low" for speed. */
  reasoningEffort: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  /** Lower runs first. */
  priority: z.number().int().min(0).max(1000).default(100),
})
export type Source = z.infer<typeof SourceSchema>
