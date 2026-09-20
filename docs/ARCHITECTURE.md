# Architecture

## One prompt, end to end

```
user prompt
  -> packages/cli parses command
  -> packages/agent opens/resumes session
  -> packages/providers picks first `ok` source in chain
  -> request streams back (SSE)
  -> tool calls execute locally (read / bash / edit, approvals enforced)
  -> on refusal: packages/quota marks source cooling/exhausted,
     jumps to next source, or waits for fastest recovery and resumes
  -> packages/quota records usage for the squeeze report
```

## Module map (25 features)

- `providers`: catalog sync, public-key flow, adapters, in-source model rotation
- `quota`: per-source state machine, unified error taxonomy, scope awareness
  (ip vs key), trust tiers, custom-endpoint gate, squeeze report
- `agent`: tool loop, sessions, thinking levels, smart retry, context care,
  model picker
- `tui`: sunset-flow theme, gradient logo, chat, quota board
- `config`: zod schemas for chain, keys, theme (env/flag overrides)
- `dashboard` (phase 2): chat + quota board + chain editor
- `cli`: binary wiring only, no business logic

## Decisions

- No Rust in phase 1. I/O-bound workload; revisit only with profiling data.
  Prefer existing native deps (ripgrep, tree-sitter WASM) before custom native code.
- No Effect. Plain async/await + zod keeps the codebase contributor-friendly.
- English everywhere in code, CLI strings, and docs.
