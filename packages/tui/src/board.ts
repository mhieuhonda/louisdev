import type { Theme } from "@louisdev/config"
import type { SourceView } from "@louisdev/quota"

const RESET = "\u001b[0m"
const BOLD = "\u001b[1m"
const DIM = "\u001b[2m"

function hex(theme: Theme, token: keyof Theme["tokens"]): [number, number, number] {
  const clean = theme.tokens[token].replace("#", "")
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ]
}

function fg(theme: Theme, token: keyof Theme["tokens"], text: string): string {
  if (process.env.NO_COLOR) return text
  const [r, g, b] = hex(theme, token)
  return `\u001b[38;2;${r};${g};${b}m${text}${RESET}`
}

function statusDot(theme: Theme, status: SourceView["status"]): string {
  if (status === "ok") return fg(theme, "success", "●")
  if (status === "cooling") return fg(theme, "warning", "●")
  return fg(theme, "error", "●")
}

/** Human countdown: 45s, 3m12s, 1h05m, 2d04h. */
export function formatWait(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m${String(sec % 60).padStart(2, "0")}s`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h${String(min % 60).padStart(2, "0")}m`
  return `${Math.floor(hr / 24)}d${String(hr % 24).padStart(2, "0")}h`
}

/** One-line status for a source, for logs and the quota board. */
export function formatSourceLine(theme: Theme, view: SourceView): string {
  const state =
    view.status === "ok"
      ? fg(theme, "success", "ready")
      : `${view.status === "cooling" ? fg(theme, "warning", "cooling") : fg(theme, "error", "exhausted")} ${fg(theme, "accent", formatWait(view.waitMs))}`
  const tail = view.lastMessage ? ` ${fg(theme, "textMuted", `· ${view.lastMessage}`)}` : ""
  const head = process.env.NO_COLOR ? `${view.source.id}` : `${BOLD}${view.source.id}${RESET}`
  return `${statusDot(theme, view.status)} ${head} ${fg(theme, "textMuted", `(${view.source.label})`)} ${state}${tail}`
}

/** Full quota board: header + one line per source. */
export function renderQuotaBoard(theme: Theme, views: SourceView[]): string {
  const title = process.env.NO_COLOR ? "quota" : `${BOLD}${fg(theme, "primary", "quota")}${RESET}`
  const hint = fg(
    theme,
    "textMuted",
    `${views.filter((v) => v.status === "ok").length}/${views.length} sources ready`,
  )
  const lines = views.map((view) => formatSourceLine(theme, view))
  const footer =
    views.length > 0 && views.every((v) => v.status !== "ok")
      ? fg(theme, "warning", "all sources cooling - waiting for fastest recovery")
      : ""
  return [`${title}  ${hint}`, ...lines.map((line) => `  ${line}`), footer].filter((l) => l !== "").join("\n")
}

export function style(theme: Theme): {
  bold: (t: string) => string
  dim: (t: string) => string
  primary: (t: string) => string
  muted: (t: string) => string
  error: (t: string) => string
} {
  if (process.env.NO_COLOR) {
    const plain = (t: string): string => t
    return { bold: plain, dim: plain, primary: plain, muted: plain, error: plain }
  }
  return {
    bold: (t) => `${BOLD}${t}${RESET}`,
    dim: (t) => `${DIM}${t}${RESET}`,
    primary: (t) => fg(theme, "primary", t),
    muted: (t) => fg(theme, "textMuted", t),
    error: (t) => fg(theme, "error", t),
  }
}
