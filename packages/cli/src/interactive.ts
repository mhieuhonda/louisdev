import fs, { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import tty from "node:tty"
import { runTurn, SessionStore, toHistory } from "@louisdev/agent"
import { type LouisDevConfig, saveKey, type Theme, type TrustTier } from "@louisdev/config"
import { QuotaManager, SqueezeReport } from "@louisdev/quota"
import { renderLogo, renderQuotaBoard, style } from "@louisdev/tui"
import { entryReady, listModelEntries, parseSelection } from "./models.ts"

export interface InteractiveInput {
  config: LouisDevConfig
  theme: Theme
  out: (text: string) => void
  err: (text: string) => void
  fetchImpl?: typeof fetch
  sessionDb?: string
  workdir?: string
  /** Resume this session instead of creating one. */
  session?: string
  autoApprove: boolean
  stdin?: NodeJS.ReadStream
  fresh?: boolean
}

const SLASH_HELP = `commands:
  /new           start a fresh session
  /models        pick a model (keyless providers first, keys auto-saved)
  /thinking      toggle the thinking stream (on/off)
  /quota         show the quota board
  /sessions      list saved sessions
  /help          this text
  /exit, /quit   leave the chat

ctrl+c stops the current answer, twice leaves the chat`

function openStdin(): NodeJS.ReadStream {
  if (process.stdin.isTTY) return process.stdin
  // Piped or detached stdin: read from the controlling terminal so the
  // chat still works (same technique as classic coding CLIs).
  const file = process.platform === "win32" ? "CONIN$" : "/dev/tty"
  try {
    return new tty.ReadStream(fs.openSync(file, "r"))
  } catch {
    throw new Error('interactive chat needs a terminal - pass a message instead: louisdev chat "..."')
  }
}

function dbPath(override?: string): string {
  if (override) return override
  if (process.env.LOUISDEV_SESSION_DB) return process.env.LOUISDEV_SESSION_DB
  return join(homedir(), ".local", "share", "louisdev", "sessions.db")
}

/**
 * Event printer shared by the interactive and one-shot chat. Streams thinking
 * dimmed (gpt-oss reasons before answering - showing it live kills the blank
 * wait), answers normal, and keeps everything else quiet.
 */
export function chatPrinter(
  out: (t: string) => void,
  err: (t: string) => void,
  ui: ReturnType<typeof style>,
) {
  let inThinking = false
  let lastSource: string | undefined
  return {
    /** Set by /thinking - when false, reasoning deltas are dropped. */
    showThinking: true,
    handle(event: {
      type: string
      delta?: string
      sourceId?: string
      model?: string
      name?: string
      output?: string
      waitMs?: number
      reason?: string
      message?: string
    }) {
      if (event.type === "thinking") {
        if (!this.showThinking) return
        if (!inThinking) {
          inThinking = true
          out(`${ui.dim("… thinking")}`)
        }
        out(ui.dim(event.delta ?? ""))
        return
      }
      if (event.type === "text") {
        if (inThinking) {
          inThinking = false
          out("\n\n")
        }
        out(event.delta ?? "")
        return
      }
      if (event.type === "source") {
        // Only announce source changes: stable picks stay silent.
        if (event.sourceId !== lastSource) {
          lastSource = event.sourceId
          err(`\n${ui.muted(`~ ${event.sourceId} / ${event.model}`)}\n`)
        }
        return
      }
      if (event.type === "tool-start") {
        if (inThinking) {
          inThinking = false
          out("\n\n")
        }
        err(`${ui.primary(`$ ${event.name}`)}\n`)
        return
      }
      if (event.type === "tool-end") err(`${ui.muted((event.output ?? "").slice(0, 500))}\n`)
      else if (event.type === "waiting")
        err(`${ui.muted(`… waiting ${Math.ceil((event.waitMs ?? 0) / 1000)}s (${event.reason})`)}\n`)
      else if (event.type === "warning") err(`${ui.error(`! ${event.message}`)}\n`)
    },
  }
}

export async function runInteractive(input: InteractiveInput): Promise<number> {
  // Open stdin first: may throw a clean error before any side effects.
  const stdin = input.stdin ?? openStdin()
  const ui = style(input.theme)
  const db = dbPath(input.sessionDb)
  if (!existsSync(join(db, ".."))) mkdirSync(join(db, ".."), { recursive: true })
  const store = new SessionStore(db)

  let sessionId: string
  const resume = input.session && !input.fresh ? store.get(input.session) : undefined
  if (input.session && !resume) {
    store.close()
    input.err(`session not found: ${input.session}\n`)
    return 2
  }
  sessionId = resume?.id ?? store.create("chat").id

  const manager = new QuotaManager(input.config.chain)
  const report = new SqueezeReport()
  const seenTrust = new Set<TrustTier>()
  const printer = chatPrinter(input.out, input.err, ui)
  let preferred: { sourceId: string; model: string } | undefined

  input.out(`${renderLogo(input.theme)}\n\n`)
  input.err(`${ui.muted("· /help commands · ctrl+c twice exits")}\n\n`)

  const rl = createInterface({ input: stdin, output: process.stderr })
  let running: AbortController | undefined
  // Bun's readline never settles a pending question when the input closes -
  // race it against the close event so ctrl+d / detached stdin exits cleanly.
  const closed = new Promise<never>((_, reject) => {
    rl.once("close", () => reject(new Error("input closed")))
  })

  rl.on("SIGINT", () => {
    if (running) {
      running.abort()
      return
    }
    rl.close()
    store.close()
    input.out("\nbye\n")
    process.exit(0)
  })

  for (;;) {
    let line: string
    try {
      line = (await Promise.race([rl.question(ui.primary("you › ")), closed])).trim()
    } catch {
      // Input closed (ctrl+d or detached stdin): treat as exit.
      rl.close()
      store.close()
      input.out("\nbye\n")
      return 0
    }
    if (line === "") continue

    if (line === "/exit" || line === "/quit") {
      rl.close()
      store.close()
      input.out("bye\n")
      return 0
    }
    if (line === "/help") {
      input.out(`${SLASH_HELP}`)
      continue
    }
    if (line === "/thinking") {
      printer.showThinking = !printer.showThinking
      input.err(`${ui.muted(`thinking ${printer.showThinking ? "on" : "off"}`)}\n\n`)
      continue
    }
    if (line === "/quota") {
      input.out(`${renderQuotaBoard(input.theme, manager.snapshot())}\n\n`)
      continue
    }
    if (line === "/sessions") {
      const sessions = store.list()
      input.out(
        sessions.length === 0
          ? "no sessions yet\n\n"
          : `${sessions.map((s) => `- ${s.id}  ${s.title}`).join("\n")}\n\n`,
      )
      continue
    }
    if (line === "/new") {
      sessionId = store.create("chat").id
      input.err(`${ui.muted(`new session ${sessionId}`)}\n\n`)
      continue
    }
    if (line === "/models") {
      const entries = await listModelEntries(input.config.chain)
      input.out(
        `${entries
          .map(
            (entry, index) =>
              `  ${index + 1}. ${entry.sourceLabel} — ${entry.model}${
                entry.needsKey && !entryReady(entry) ? `  ${ui.error(`(needs ${entry.keyVar})`)}` : ""
              }`,
          )
          .join("\n")}\n\n`,
      )
      let selectionText: string
      try {
        selectionText = await Promise.race([rl.question(ui.primary("select › ")), closed])
      } catch {
        rl.close()
        store.close()
        input.out("\nbye\n")
        return 0
      }
      const selection = parseSelection(selectionText, entries)
      if (selection.type === "cancel") continue
      if (selection.type === "invalid") {
        input.err(`${ui.error(`no model number: ${selection.input}`)}\n\n`)
        continue
      }
      const entry = selection.entry
      if (entry.needsKey && entry.keyVar && !entryReady(entry)) {
        let keyValue: string
        try {
          input.err(`${ui.primary(`${entry.sourceLabel} needs an API key (${entry.keyVar})`)}\n`)
          keyValue = (await Promise.race([rl.question("key › "), closed])).trim()
        } catch {
          rl.close()
          store.close()
          input.out("\nbye\n")
          return 0
        }
        if (keyValue === "") {
          input.err(`${ui.muted("cancelled - keyless sources still work")}\n\n`)
          continue
        }
        saveKey(entry.keyVar, keyValue)
        input.err(`${ui.muted(`key saved as your default for ${entry.sourceId}`)}\n`)
      }
      preferred = { sourceId: entry.sourceId, model: entry.model }
      input.err(`${ui.muted(`selected: ${entry.sourceId} / ${entry.model}`)}\n\n`)
      continue
    }

    const history = toHistory(store.get(sessionId)?.messages ?? [])
    running = new AbortController()
    // Pause readline while the answer streams: input typed mid-turn stays
    // buffered and is delivered to the next prompt instead of being dropped.
    rl.pause()
    try {
      await runTurn({
        manager,
        report,
        store,
        sessionId,
        input: line,
        history,
        preferred,
        toolCtx: { workdir: input.workdir ?? process.cwd(), autoApprove: input.autoApprove },
        fetchImpl: input.fetchImpl,
        seenTrust,
        signal: running.signal,
        onEvent: (event) => printer.handle(event),
      })
      input.out("\n\n")
    } catch (error) {
      input.out("\n\n")
      if (error instanceof Error && error.message === "aborted") input.err(`${ui.muted("stopped")}\n\n`)
      else input.err(`${ui.error(error instanceof Error ? error.message : String(error))}\n\n`)
    } finally {
      running = undefined
      rl.resume()
    }
  }
}
