import type { Source, TrustTier } from "@louisdev/config"

export type NoticeLevel = "silent" | "warn-once" | "confirm-always"

export interface TrustNotice {
  level: NoticeLevel
  message: string
}

const LEVEL_BY_TIER: Record<TrustTier, NoticeLevel> = {
  verified: "silent",
  community: "warn-once",
  custom: "confirm-always",
}

/**
 * Notices for using a source. `seen` tracks tier warnings already shown
 * this session so community sources warn exactly once.
 */
export function trustNotices(source: Source, seen: Set<TrustTier>): TrustNotice[] {
  const level = LEVEL_BY_TIER[source.trust]
  if (level === "silent") return []
  if (level === "warn-once" && seen.has(source.trust)) return []
  if (source.trust === "community") {
    return [
      {
        level,
        message: `${source.label}: community-run source. Limits may be opaque and requests may be logged by its operator.`,
      },
    ]
  }
  return [
    {
      level,
      message: `${source.label}: custom endpoint (${source.baseUrl}). Confirm before use - secrets are never sent automatically.`,
    },
  ]
}
