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

## Quickstart

```sh
bun install

# chat (default chain: pollinations keyless -> openrouter free)
bun run dev chat "explain this repo in one line"

# inspect the live chain and quota board
bun run dev chain
bun run dev quota

# sessions persist in ~/.local/share/louisdev/sessions.db
bun run dev sessions

# web dashboard
bun run ui
```

Tools (`read`, `edit`, `bash`) need `--auto-approve` to run without asking:

```sh
bun run dev chat "list the files here" --auto-approve
```

## Packages

| Package | Role |
|---|---|
| `packages/cli` | `louisdev` binary: chat, quota, chain, sessions |
| `packages/agent` | Rotation loop, tool execution with approvals, SQLite sessions |
| `packages/providers` | SSE streaming, catalog sync, OpenAI-compatible senders |
| `packages/quota` | Quota manager, refusal classification, trust tiers, squeeze report |
| `packages/tui` | Gradient logo, theme loader, quota board renderers |
| `packages/config` | Zod schemas: chain, keys, theme |
| `packages/dashboard` | Local web UI: quota board, source chain, sessions (Hono) |

## Tech stack

Bun + TypeScript strict · SSE streaming (adapters written from scratch) ·
SQLite (bun:sqlite) · Hono (dashboard) · Zod v4 · Biome + bun test.

No Rust in phase 1, no Effect runtime, no images in the TUI (see docs/ARCHITECTURE.md).

## Contributing

Issues and PRs welcome. Keep it English, keep it simple, keep it free-max.
