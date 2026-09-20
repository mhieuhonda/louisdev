import path from "node:path"
import { z } from "zod"

export interface ToolContext {
  workdir: string
  autoApprove: boolean
}

export interface ToolDefinition<I = unknown> {
  name: string
  description: string
  input: z.ZodType<I>
  execute(input: I, ctx: ToolContext): Promise<string>
}

export class ApprovalNeededError extends Error {
  readonly tool: string
  constructor(tool: string) {
    super(`approval required for ${tool}`)
    this.name = "ApprovalNeededError"
    this.tool = tool
  }
}

const BLOCKED_COMMANDS: RegExp[] = [
  /\brm\s+-rf?\s+(\/|~(\/|$)|\$HOME(\/|$))/,
  /\bmkfs\b/,
  /\bdd\s+.*of=\/dev\//,
  /:\(\)\s*\{/,
  /\b(shutdown|reboot|poweroff|halt)\b/,
  />\s*\/dev\/sd[a-z]/,
  /\bchmod\s+-R\s+777\s+\//,
]

export function isBlockedCommand(command: string): boolean {
  return BLOCKED_COMMANDS.some((pattern) => pattern.test(command))
}

function resolveInWorkdir(workdir: string, target: string): string {
  const resolved = path.resolve(workdir, target)
  const root = path.resolve(workdir) + path.sep
  if (!resolved.startsWith(root) && resolved !== path.resolve(workdir)) {
    throw new ApprovalNeededError(`path outside workdir: ${target}`)
  }
  return resolved
}

const MAX_OUTPUT = 32_768

function truncate(text: string): string {
  return text.length > MAX_OUTPUT
    ? `${text.slice(0, MAX_OUTPUT)}\n…[truncated ${text.length - MAX_OUTPUT} chars]`
    : text
}

export const ReadTool: ToolDefinition<{ path: string }> = {
  name: "read",
  description: "Read a UTF-8 text file, resolved inside the workdir.",
  input: z.object({ path: z.string().min(1) }),
  execute: async (input, ctx) => {
    const file = Bun.file(resolveInWorkdir(ctx.workdir, input.path))
    if (!(await file.exists())) throw new Error(`file not found: ${input.path}`)
    return truncate(await file.text())
  },
}

export const EditTool: ToolDefinition<{ path: string; oldText: string; newText: string }> = {
  name: "edit",
  description: "Replace exactly one occurrence of oldText with newText in a file.",
  input: z.object({ path: z.string().min(1), oldText: z.string().min(1), newText: z.string() }),
  execute: async (input, ctx) => {
    if (!ctx.autoApprove) throw new ApprovalNeededError("edit")
    const resolved = resolveInWorkdir(ctx.workdir, input.path)
    const file = Bun.file(resolved)
    if (!(await file.exists())) throw new Error(`file not found: ${input.path}`)
    const content = await file.text()
    const first = content.indexOf(input.oldText)
    if (first < 0) throw new Error(`oldText not found in ${input.path}`)
    if (content.indexOf(input.oldText, first + 1) >= 0) {
      throw new Error(`oldText matches multiple times in ${input.path} - be more specific`)
    }
    await Bun.write(
      resolved,
      content.slice(0, first) + input.newText + content.slice(first + input.oldText.length),
    )
    return `edited ${input.path}`
  },
}

export const BashTool: ToolDefinition<{ command: string; cwd?: string; timeoutMs?: number }> = {
  name: "bash",
  description: "Run a shell command. Dangerous commands are always refused.",
  input: z.object({
    command: z.string().min(1),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().max(300_000).optional(),
  }),
  execute: async (input, ctx) => {
    if (!ctx.autoApprove) throw new ApprovalNeededError("bash")
    if (isBlockedCommand(input.command)) throw new Error(`refused dangerous command: ${input.command}`)
    const cwd = input.cwd ? resolveInWorkdir(ctx.workdir, input.cwd) : ctx.workdir
    const proc = Bun.spawn(["bash", "-c", input.command], { cwd, stdout: "pipe", stderr: "pipe" })
    const timeout = setTimeout(() => proc.kill(), input.timeoutMs ?? 30_000)
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      const combined = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).trim()
      return truncate(combined === "" ? `[exit code: ${code}]` : `${combined}\n[exit code: ${code}]`)
    } finally {
      clearTimeout(timeout)
    }
  },
}

export const TOOLS: ToolDefinition[] = [ReadTool, EditTool, BashTool]

/** JSON Schema for advertising tools to models (OpenAI function-calling shape). */
export function toolSpecs(): { name: string; description: string; parameters: Record<string, unknown> }[] {
  return [
    {
      name: ReadTool.name,
      description: ReadTool.description,
      parameters: z.toJSONSchema(ReadTool.input) as Record<string, unknown>,
    },
    {
      name: EditTool.name,
      description: EditTool.description,
      parameters: z.toJSONSchema(EditTool.input) as Record<string, unknown>,
    },
    {
      name: BashTool.name,
      description: BashTool.description,
      parameters: z.toJSONSchema(BashTool.input) as Record<string, unknown>,
    },
  ]
}

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name)
}
