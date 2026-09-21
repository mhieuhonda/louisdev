import { readKey, type Source, type TrustTier } from "@louisdev/config"
import { type ChatMessage, ProviderRequestError, sendChat } from "@louisdev/providers"
import { type QuotaManager, type SqueezeReport, trustNotices } from "@louisdev/quota"
import type { SessionStore } from "./store.ts"
import {
  ApprovalNeededError,
  findTool,
  TOOLS,
  type ToolContext,
  type ToolDefinition,
  toolSpecs,
} from "./tools.ts"

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "source"; sourceId: string; model: string }
  | { type: "tool-start"; name: string }
  | { type: "tool-end"; name: string; output: string }
  | { type: "waiting"; waitMs: number; reason: string }
  | { type: "warning"; message: string }
  | { type: "done"; text: string; steps: number }

export interface RunOptions {
  manager: QuotaManager
  report: SqueezeReport
  store: SessionStore
  sessionId: string
  input: string
  toolCtx: ToolContext
  tools?: ToolDefinition[]
  /** Prior conversation turns (from the session store) sent as context. */
  history?: ChatMessage[]
  maxSteps?: number
  requestTimeoutMs?: number
  fetchImpl?: typeof fetch
  seenTrust?: Set<TrustTier>
  onEvent?: (event: AgentEvent) => void
  signal?: AbortSignal
}

export interface RunResult {
  text: string
  steps: number
  sourcesUsed: string[]
}

/**
 * Convert stored session messages into API history. Stored tool results
 * become user messages (tool role carries provider-specific semantics we
 * do not model); caps to the newest `limit` messages to bound requests.
 */
export function toHistory(rows: { role: string; content: string }[], limit = 30): ChatMessage[] {
  return rows
    .slice(-limit)
    .filter((row) => row.content.trim() !== "")
    .map((row) => ({ role: row.role === "assistant" ? "assistant" : "user", content: row.content }))
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error("aborted"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function missingEnvKey(source: Source): string | undefined {
  if (source.auth.type !== "env") return undefined
  return readKey({ name: source.auth.var }) === undefined ? source.auth.var : undefined
}

/**
 * Run one user turn: rotate sources until one answers, execute tool calls,
 * repeat until the model stops or maxSteps is hit. Never self-limits -
 * when every source refuses, waits for the fastest recovery and resumes.
 */
export async function runTurn(options: RunOptions): Promise<RunResult> {
  const tools = options.tools ?? TOOLS
  const maxSteps = options.maxSteps ?? 10
  const seenTrust = options.seenTrust ?? new Set<TrustTier>()
  const emit = options.onEvent ?? ((): void => undefined)
  const sourcesUsed: string[] = []
  let steps = 0
  let lastText = ""

  const history = options.history ?? []
  const messages: ChatMessage[] = [...history, { role: "user", content: options.input }]
  options.store.append(options.sessionId, "user", options.input)

  for (;;) {
    if (options.signal?.aborted) throw new Error("aborted")
    const source = options.manager.pick()
    if (!source) {
      const waitMs = options.manager.nextRecoveryMs()
      if (waitMs === undefined) throw new Error("all sources unavailable (auth parked) - fix keys and retry")
      emit({ type: "waiting", waitMs, reason: "all sources cooling - waiting for fastest recovery" })
      await sleep(waitMs, options.signal)
      continue
    }
    const missing = missingEnvKey(source)
    if (missing) {
      emit({ type: "warning", message: `source ${source.id} skipped: env ${missing} is not set` })
      options.manager.refuse(source.id, { status: 401, headers: {}, body: "missing env key" })
      continue
    }
    const model = source.models[0]
    if (!model) throw new Error(`source ${source.id} has no models configured`)
    for (const notice of trustNotices(source, seenTrust)) {
      emit({ type: "warning", message: notice.message })
    }
    seenTrust.add(source.trust)
    if (!sourcesUsed.includes(source.id)) sourcesUsed.push(source.id)
    emit({ type: "source", sourceId: source.id, model })

    const timeout = AbortSignal.timeout(options.requestTimeoutMs ?? 120_000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let text = ""
    const toolcalls: { id: string; name: string; args: string }[] = []
    try {
      const stream = sendChat({
        source,
        model,
        messages,
        tools: toolSpecs(),
        signal,
        fetchImpl: options.fetchImpl,
      })
      for await (const event of stream) {
        if (event.type === "text") {
          text += event.delta
          emit({ type: "text", delta: event.delta })
        } else {
          toolcalls.push(event)
        }
      }
    } catch (error) {
      if (error instanceof ProviderRequestError) {
        options.report.recordRequest(source.id)
        options.report.recordRefusal(source.id)
        options.manager.refuse(source.id, { status: error.status, headers: error.headers, body: error.body })
        continue
      }
      throw error
    }
    options.report.recordRequest(source.id)
    options.report.recordSuccess(source.id)
    options.manager.succeed(source.id)
    lastText = text
    options.store.append(options.sessionId, "assistant", text)
    steps += 1

    if (toolcalls.length === 0 || steps >= maxSteps) break
    for (const call of toolcalls) {
      emit({ type: "tool-start", name: call.name })
      const output = await executeCall(call.name, call.args, tools, options.toolCtx)
      emit({ type: "tool-end", name: call.name, output })
      messages.push({ role: "assistant", content: text === "" ? `(tool calls)` : text })
      messages.push({ role: "user", content: `[tool ${call.name} result]\n${output}` })
      options.store.append(options.sessionId, "tool", `[${call.name}]\n${output}`)
    }
  }

  emit({ type: "done", text: lastText, steps })
  return { text: lastText, steps, sourcesUsed }
}

async function executeCall(
  name: string,
  argsText: string,
  tools: ToolDefinition[],
  ctx: ToolContext,
): Promise<string> {
  const tool = findTool(name) ?? tools.find((t) => t.name === name)
  if (!tool) return `error: unknown tool "${name}"`
  let input: unknown
  try {
    input = JSON.parse(argsText) as unknown
  } catch {
    return `error: tool "${name}" received invalid JSON args`
  }
  const parsed = tool.input.safeParse(input)
  if (!parsed.success) return `error: tool "${name}" received invalid args`
  try {
    return await tool.execute(parsed.data, ctx)
  } catch (error) {
    if (error instanceof ApprovalNeededError) return `denied: ${error.message}`
    return `error: ${error instanceof Error ? error.message : String(error)}`
  }
}
