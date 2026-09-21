#!/usr/bin/env bun
export * from "./args.ts"
export * from "./commands.ts"

import { run } from "./commands.ts"

if (import.meta.main) {
  const code = await run(Bun.argv.slice(2), {
    out: (t) => process.stdout.write(t),
    err: (t) => process.stderr.write(t),
  })
  process.exit(code)
}
