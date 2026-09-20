import { type Protocol, readKey, type Source } from "@louisdev/config"
import { SSEParser } from "./sse.ts"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export class ProviderRequestError extends Error {
  readonly status: number | undefined
  readonly headers: Record<string, string | undefined>
  readonly body: string | undefined

  constructor(message: string, status?: number, headers?: Record<string, string | undefined>, body?: string) {
    super(message)
    this.name = "ProviderRequestError"
    this.status = status
    this.headers = headers ?? {}
    this.body = body
  }
}

const USER_AGENT = "louisdev/0.0.1 (+https://github.com/mhieuhonda/louisdev)"

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "toolcall"; id: string; name: string; args: string }

export interface SendOptions {
  source: Source
  model: string
  messages: ChatMessage[]
  /** Advertised on openai-chat only. Other protocols ignore tools for now. */
  tools?: ToolSpec[]
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

function endpointFor(source: Source): string {
  const base = source.baseUrl.replace(/\/$/, "")
  const protocol: Protocol = source.protocol
  if (protocol === "openai-chat") return `${base}/chat/completions`
  if (protocol === "openai-responses") return `${base}/responses`
  throw new ProviderRequestError(`protocol not supported yet: ${protocol} (source ${source.id})`)
}

function headersFor(source: Source): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": USER_AGENT,
  }
  if (source.auth.type === "env") {
    const key = readKey({ name: source.auth.var })
    if (!key)
      throw new ProviderRequestError(
        `missing secret: env ${source.auth.var} is not set (source ${source.id})`,
      )
    headers["Authorization"] = `Bearer ${key}`
  }
  if (source.auth.type === "public") {
    // Public-key flow: the key travels as a bearer token (server reads the
    // Authorization header, never the body). "public" means anonymous.
    headers["Authorization"] = `Bearer ${source.auth.key}`
  }
  return headers
}

function bodyFor(source: Source, model: string, messages: ChatMessage[], tools?: ToolSpec[]): Record<string, unknown> {
  const body: Record<string, unknown> = { model, stream: true }
  if (source.protocol === "openai-chat") {
    body["messages"] = messages.map((m) => ({ role: m.role, content: m.content }))
    if (tools && tools.length > 0) {
      body["tools"] = tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }))
    }
  } else {
    body["input"] = messages.map((m) => ({ role: m.role, content: m.content }))
  }
  return body
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function chatDelta(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const choices = payload["choices"]
  if (!Array.isArray(choices)) return undefined
  const first = choices[0]
  if (!isRecord(first)) return undefined
  const delta = first["delta"]
  if (!isRecord(delta)) return undefined
  return typeof delta["content"] === "string" ? delta["content"] : undefined
}

function responsesDelta(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  if (payload["type"] === "response.output_text.delta" && typeof payload["delta"] === "string") {
    return payload["delta"]
  }
  return undefined
}

interface PendingToolCall {
  id: string
  name: string
  args: string
}

/** Accumulate streaming tool_call chunks (openai-chat). Returns new arrivals. */
function accumulateToolCalls(payload: unknown, pending: Map<number, PendingToolCall>): void {
  if (!isRecord(payload)) return
  const choices = payload["choices"]
  if (!Array.isArray(choices)) return
  const first = choices[0]
  if (!isRecord(first)) return
  const delta = first["delta"]
  if (!isRecord(delta)) return
  const calls = delta["tool_calls"]
  if (!Array.isArray(calls)) return
  for (const call of calls) {
    if (!isRecord(call)) continue
    const index = typeof call["index"] === "number" ? call["index"] : 0
    const current = pending.get(index) ?? { id: "", name: "", args: "" }
    if (typeof call["id"] === "string" && call["id"] !== "") current.id = call["id"]
    const fn = call["function"]
    if (isRecord(fn)) {
      if (typeof fn["name"] === "string" && fn["name"] !== "") current.name = fn["name"]
      if (typeof fn["arguments"] === "string") current.args += fn["arguments"]
    }
    pending.set(index, current)
  }
}

/**
 * Stream one chat completion. Yields text deltas live; complete tool calls
 * are yielded whole at the end of the stream. Throws ProviderRequestError
 * carrying status/headers/body so the quota layer can classify the refusal.
 * Tool calls are only parsed for openai-chat.
 */
export async function* sendChat(options: SendOptions): AsyncGenerator<StreamEvent> {
  const fetchImpl = options.fetchImpl ?? fetch
  const url = endpointFor(options.source)
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: headersFor(options.source),
      body: JSON.stringify(bodyFor(options.source, options.model, options.messages, options.tools)),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error
    throw new ProviderRequestError(
      `source unreachable: ${options.source.id}`,
      undefined,
      {},
      error instanceof Error ? error.message : String(error),
    )
  }
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => undefined)
    const headers: Record<string, string | undefined> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    throw new ProviderRequestError(
      `request refused (HTTP ${response.status}) by ${options.source.id}`,
      response.status,
      headers,
      body?.slice(0, 4000),
    )
  }
  const parser = new SSEParser()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const isChat = options.source.protocol === "openai-chat"
  const extract = isChat ? chatDelta : responsesDelta
  const pending = new Map<number, PendingToolCall>()
  const flushToolCalls = function* (): Generator<StreamEvent> {
    for (const call of [...pending.values()].toSorted((a, b) => a.id.localeCompare(b.id))) {
      if (call.name !== "") yield { type: "toolcall", id: call.id, name: call.name, args: call.args }
    }
    pending.clear()
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      yield* flushToolCalls()
      return
    }
    for (const event of parser.feed(decoder.decode(value, { stream: true }))) {
      if (parser.isDone(event.data)) {
        yield* flushToolCalls()
        return
      }
      if (!event.data) continue
      let payload: unknown
      try {
        payload = JSON.parse(event.data) as unknown
      } catch {
        continue
      }
      if (isChat) accumulateToolCalls(payload, pending)
      const delta = extract(payload)
      if (delta) yield { type: "text", delta }
    }
  }
}
