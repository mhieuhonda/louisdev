import type { Theme } from "@louisdev/config"

/**
 * LouisDev wordmark. Each letter is drawn on a fixed 5-column grid in
 * heavy geometric block style (ANSI-shadow family); letters are joined
 * with code so spacing can never drift. Original art.
 */
const LETTERS: Record<string, string[]> = {
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  O: [" ███ ", "█   █", "█   █", "█   █", " ███ "],
  U: ["█   █", "█   █", "█   █", "█   █", " ███ "],
  I: ["█████", "  █  ", "  █  ", "  █  ", "█████"],
  S: [" ████", "█    ", " ███ ", "    █", "████ "],
  D: ["████ ", "█   █", "█   █", "█   █", "████ "],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
}

const WORD = "LOUISDEV"
const GAP = "  "

/** Plain (no color) wordmark lines. */
export function plainLogo(): string[] {
  return [0, 1, 2, 3, 4].map((row) =>
    WORD.split("")
      .map((char) => LETTERS[char]?.[row] ?? "     ")
      .join(GAP),
  )
}

const RESET = "\u001b[0m"
const BOLD = "\u001b[1m"

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "")
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ]
}

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ]
}

function paint(rgb: Rgb, text: string): string {
  return `\u001b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}`
}

/**
 * Render the wordmark with a sunset gradient (primary -> secondary) flowing
 * left to right. Pure ANSI, no images - crisp on every truecolor terminal.
 * Honors NO_COLOR with plain bold-free output.
 */
export function renderLogo(theme: Theme, width = 80): string {
  const lines = plainLogo()
  const tagline = "free-max coding CLI"
  if (process.env.NO_COLOR) return [...lines, tagline].join("\n")
  const from = hexToRgb(theme.tokens.primary)
  const to = hexToRgb(theme.tokens.secondary)
  const total = lines.join("").replace(/ /g, "").length
  let seen = 0
  const painted = lines.map((line) => {
    const out = [...line]
      .map((char) => {
        if (char === " ") return char
        seen += 1
        return paint(mix(from, to, total <= 1 ? 0 : (seen - 1) / (total - 1)), char)
      })
      .join("")
    return `${BOLD}${out}${RESET}`
  })
  const padding = " ".repeat(Math.max(0, Math.floor((width - tagline.length) / 2)))
  return `${painted.join("\n")}\n${padding}${paint(muted(theme), tagline)}${RESET}`
}

function muted(theme: Theme): Rgb {
  return hexToRgb(theme.tokens.textMuted)
}
