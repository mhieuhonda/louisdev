import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { runTurn, SessionStore, toHistory } from "@louisdev/agent"
import { type LouisDevConfig, loadConfig, orderedSources, type Theme, type TrustTier } from "@louisdev/config"
import { QuotaManager, SqueezeReport } from "@louisdev/quota"
import { loadTheme, renderLogo, renderQuotaBoard, style } from "@louisdev/tui"
import { helpText, type ParsedArgs, parseArgs, VERSION } from "./args.ts"
import { chatPrinter, runInteractive } from "./interactive.ts"
import { entryReady, listModelEntries } from "./models.ts"

export interface RunContext {
  out: (text: string) => void
  err: (text: string) => void
  fetchImpl?: typeof fetch
  sessionDb?: string
  workdir?: string
  stdin?: NodeJS.ReadStream
}

function sessionDbPath(override?: string): string {
  if (override) return override
  if (process.env.LOUISDEV_SESSION_DB) return process.env.LOUISDEV_SESSION_DB
  return join(homedir(), ".local", "share", "louisdev", "sessions.db")
}

function ensureParentDir(file: string): void {
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
}

export async function run(argv: string[], ctx: RunContext): Promise<number> {
  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    ctx.err(error instanceof Error ? error.message : String(error))
    return 2
  }
  if (parsed.command === "help") {
    ctx.out(helpText())
    return 0
  }
  if (parsed.command === "version") {
    ctx.out(`louisdev ${VERSION}\n`)
    return 0
  }

  let config: LouisDevConfig
  try {
    config = await loadConfig({ configPath: parsed.configPath, theme: parsed.theme })
  } catch (error) {
    ctx.err(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  let theme: Theme
  try {
    theme = await loadTheme(config.theme)
  } catch (error) {
    ctx.err(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  const ui = style(theme)

  if (parsed.command === "quota") {
    const manager = new QuotaManager(config.chain)
    ctx.out(`${renderQuotaBoard(theme, manager.snapshot())}\n`)
    return 0
  }
  if (parsed.command === "chain") {
    for (const source of orderedSources(config.chain)) {
      ctx.out(
        `- ${ui.bold(source.id)} ${ui.muted(`(${source.label})`)} [${source.trust}] ${source.baseUrl}\n`,
      )
    }
    return 0
  }
  if (parsed.command === "sessions") {
    const db = sessionDbPath(ctx.sessionDb)
    ensureParentDir(db)
    const store = new SessionStore(db)
    try {
      const sessions = store.list()
      if (sessions.length === 0) ctx.out("no sessions yet\n")
      for (const session of sessions) {
        ctx.out(`- ${session.id}  ${session.title}  ${new Date(session.updatedAt).toISOString()}\n`)
      }
    } finally {
      store.close()
    }
    return 0
  }
  if (parsed.command === "models") {
    const entries = await listModelEntries(config.chain).catch(() => [])
    for (const entry of entries) {
      const keyNote = entry.needsKey && !entryReady(entry) ? `  ${ui.error(`(needs ${entry.keyVar})`)}` : ""
      ctx.out(`- ${ui.bold(entry.sourceLabel)} — ${entry.model}${keyNote}\n`)
    }
    if (entries.length === 0) ctx.out("no models listed\n")
    return 0
  }

  const message = parsed.positional.join(" ").trim()
  if (message === "") {
    // No message: open the interactive chat right in the terminal.
    return runInteractive({
      config,
      theme,
      out: ctx.out,
      err: ctx.err,
      fetchImpl: ctx.fetchImpl,
      sessionDb: ctx.sessionDb,
      workdir: ctx.workdir,
      session: parsed.session,
      fresh: parsed.fresh,
      autoApprove: parsed.autoApprove,
      stdin: ctx.stdin,
    })
  }
  const db = sessionDbPath(ctx.sessionDb)
  ensureParentDir(db)
  const store = new SessionStore(db)
  try {
    let sessionId: string
    if (parsed.session && !parsed.fresh) {
      const existing = store.get(parsed.session)
      if (!existing) {
        ctx.err(`session not found: ${parsed.session}\n`)
        return 2
      }
      sessionId = existing.id
    } else {
      sessionId = store.create(message.slice(0, 40)).id
    }
    ctx.out(`${renderLogo(theme)}\n\n`)
    const manager = new QuotaManager(config.chain)
    const report = new SqueezeReport()
    const seenTrust = new Set<TrustTier>()
    const printer = chatPrinter(ctx.out, ctx.err, ui)
    const result = await runTurn({
      manager,
      report,
      store,
      sessionId,
      input: message,
      history: toHistory(store.get(sessionId)?.messages ?? []),
      toolCtx: { workdir: ctx.workdir ?? process.cwd(), autoApprove: parsed.autoApprove },
      fetchImpl: ctx.fetchImpl,
      seenTrust,
      onEvent: (event) => printer.handle(event),
    })
    ctx.out("\n")
    const summary = report.summary()
    ctx.err(
      `${ui.muted(`done in ${result.steps} step(s) via ${result.sourcesUsed.join(", ") || "none"} · ${summary.totalRequests} request(s), ${summary.totalRefusals} refusal(s) · session ${sessionId}`)}\n`,
    )
    return 0
  } finally {
    store.close()
  }
}
