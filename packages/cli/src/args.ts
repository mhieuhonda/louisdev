export const VERSION = "0.0.1"

export type Command = "chat" | "quota" | "chain" | "sessions" | "help" | "version"

export interface ParsedArgs {
  command: Command
  positional: string[]
  session: string | undefined
  fresh: boolean
  autoApprove: boolean
  configPath: string | undefined
  theme: string | undefined
}

const HELP = `louisdev ${VERSION} - free-max coding CLI

Usage:
  louisdev chat <message> [--session <id>] [--new] [--auto-approve]
  louisdev quota
  louisdev chain
  louisdev sessions
  louisdev help | version

Options:
  --session <id>   resume a session (chat)
  --new            always start a fresh session (chat)
  --auto-approve   allow bash/edit without asking (chat)
  --config <path>  config file path
  --theme <name>   theme name

Environment:
  LOUISDEV_CONFIG       config file path
  LOUISDEV_THEME        theme name
  OPENROUTER_API_KEY    key for the openrouter-free source
`

export function helpText(): string {
  return HELP
}

/** Minimal dependency-free argv parser. argv excludes node/bun and script. */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  let session: string | undefined
  let fresh = false
  let autoApprove = false
  let configPath: string | undefined
  let theme: string | undefined
  let command: Command = "help"
  let seenCommand = false

  const takeValue = (index: number, flag: string): string => {
    const value = argv[index]
    if (value === undefined || value === "") throw new Error(`flag ${flag} needs a value`)
    return value
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ""
    if (!seenCommand && !arg.startsWith("-")) {
      seenCommand = true
      if (arg === "chat" || arg === "quota" || arg === "chain" || arg === "sessions") command = arg
      else if (arg === "help" || arg === "--help" || arg === "-h") command = "help"
      else if (arg === "version" || arg === "--version" || arg === "-v") command = "version"
      else throw new Error(`unknown command: ${arg}\n${HELP}`)
      continue
    }
    if (arg === "--session") {
      session = takeValue(i + 1, "--session")
      i += 1
    } else if (arg === "--new") {
      fresh = true
    } else if (arg === "--auto-approve") {
      autoApprove = true
    } else if (arg === "--config") {
      configPath = takeValue(i + 1, "--config")
      i += 1
    } else if (arg === "--theme") {
      theme = takeValue(i + 1, "--theme")
      i += 1
    } else if (arg === "--help" || arg === "-h") {
      command = "help"
    } else if (arg === "--version" || arg === "-v") {
      command = "version"
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown flag: ${arg}\n${HELP}`)
    } else {
      positional.push(arg)
    }
  }
  return { command, positional, session, fresh, autoApprove, configPath, theme }
}
