import { homedir } from "node:os"
import { join } from "node:path"
import { createApp } from "./index.ts"

const port = Number(process.env.LOUISDEV_PORT ?? 3111)
const sessionDb =
  process.env.LOUISDEV_SESSION_DB ?? join(homedir(), ".local", "share", "louisdev", "sessions.db")

const server = Bun.serve({
  port,
  fetch: createApp({ sessionDb }).fetch,
})

console.log(`louisdev dashboard -> http://localhost:${server.port}`)
