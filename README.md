# LouisDev

Free-max AI coding CLI. One agent, many free sources, zero setup.

LouisDev routes every request through an ordered chain of public free model
sources. When a source refuses (rate limit, exhausted quota), the quota
manager cools it down, jumps to the next source, and auto-resumes when the
fastest one recovers. Use free until the other side says no.

## Vision

- **Free-max**: never self-limit. Call until refused, wait for reset, continue.
- **Multi-source rotation**: IP-scoped and key-scoped quotas tracked separately.
- **Trust tiers**: verified / community / custom sources with explicit warnings.
- **Community first**: English everywhere, TypeScript, no exotic runtime magic.

## Quickstart (planned)

```sh
bun install
bun run --cwd packages/cli src/index.ts
```

## Packages

| Package | Role |
|---|---|
| `packages/cli` | `louisdev` / `ld` binary (citty commands) |
| `packages/agent` | Tool loop, sessions, retry, thinking levels |
| `packages/providers` | Source chain + adapters (public-key flow, OpenRouter, Gemini...) |
| `packages/quota` | Quota manager, trust tiers, squeeze report |
| `packages/tui` | OpenTUI: chat, quota board, sunset-flow theme |
| `packages/config` | Zod schemas: chain, keys, theme |
| `packages/dashboard` | (phase 2) Local web UI: chat + quota board + chain editor |

## Tech stack

Bun + TypeScript strict · OpenTUI (SolidJS) · Vercel AI SDK · citty + consola ·
SQLite + drizzle · Hono + React (dashboard) · Biome + bun test.

No Rust in phase 1 (see docs/ARCHITECTURE.md).

## Contributing

Issues and PRs welcome. Keep it English, keep it simple, keep it free-max.
