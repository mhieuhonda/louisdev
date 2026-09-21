# LouisDev

Free-max AI coding CLI. One agent, many free sources, zero setup.

LouisDev routes every request through an ordered chain of free model sources.
The default source needs no account and no key. When a source refuses (rate
limit, exhausted quota), the quota manager cools it down, jumps to the next
source, and auto-resumes when the fastest one recovers. Use free until the
other side says no.

Built-in sources: Pollinations (keyless, default) - OpenRouter Free (free
key) - NVIDIA NIM Free (free key, 40+ models) - OpenCode Zen (key, muse-spark).

## Vision

- **Free-max**: never self-limit. Call until refused, wait for reset, continue.
- **Multi-source rotation**: IP-scoped and key-scoped quotas tracked separately.
- **Trust tiers**: verified / community / custom sources with explicit warnings.
- **Community first**: English everywhere, TypeScript, no exotic runtime magic.

## Quickstart

```sh
bun install
cd packages/cli && bun link   # exposes louisdev and ld
```

Then just chat, right in the terminal:

```sh
louisdev
```

You get a prompt (`you ›`), type a message, the answer streams live - including
the model's thinking (dimmed) while it reasons, so there is no blank wait. The
conversation keeps context across turns.

Slash commands:

- `/models` - pick a model. Keyless providers first; key-required providers
  (OpenRouter, NVIDIA NIM, OpenCode Zen) prompt for an API key once and store
  it as your default for that provider.
- `/thinking` - toggle the thinking stream on/off.
- `/new` - fresh session. `/quota` - quota board. `/sessions` - saved sessions.
- `/exit` - leave. Ctrl+C stops the current answer, twice leaves the chat.

One-shot mode for scripts:

```sh
ld chat "explain this repo in one line"
ld models          # list models by provider (keyless first)
ld quota           # live quota board
ld chain           # source chain by priority
ld sessions        # saved sessions
```

Tools (`read`, `edit`, `bash`) need `--auto-approve` to run without asking:

```sh
ld chat "list the files here" --auto-approve
```

## Packages

| Package | Role |
|---|---|
| `packages/cli` | `louisdev` binary: interactive chat, one-shot, quota, chain, sessions |
| `packages/agent` | Rotation loop, tool execution with approvals, SQLite sessions |
| `packages/providers` | SSE streaming, catalog sync, OpenAI-compatible senders |
| `packages/quota` | Quota manager, refusal classification, trust tiers, squeeze report |
| `packages/tui` | Gradient logo, theme loader, quota board renderers |
| `packages/config` | Zod schemas: chain, keys, theme |

## Tech stack

Bun + TypeScript strict · SSE streaming (adapters written from scratch) ·
SQLite (bun:sqlite) · Zod v4 · Biome + bun test.

Terminal only - no web UI, no Rust in phase 1, no Effect runtime, no images
in the TUI (see docs/ARCHITECTURE.md).

## Contributing

Issues and PRs welcome. Keep it English, keep it simple, keep it free-max.
