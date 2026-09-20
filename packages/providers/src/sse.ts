export interface ServerSentEvent {
  event: string | undefined
  data: string
}

const DONE = "[DONE]"

/**
 * Incremental SSE parser. Feed raw text chunks, receive complete events.
 * Handles chunk splits mid-line and multi-line data fields.
 */
export class SSEParser {
  private buffer = ""
  private pendingEvent: string | undefined
  private pendingData: string[] = []

  feed(chunk: string): ServerSentEvent[] {
    this.buffer += chunk
    const out: ServerSentEvent[] = []
    for (;;) {
      const index = this.buffer.indexOf("\n")
      if (index < 0) break
      const line = this.buffer.slice(0, index).replace(/\r$/, "")
      this.buffer = this.buffer.slice(index + 1)
      if (line === "") {
        if (this.pendingData.length > 0 || this.pendingEvent !== undefined) {
          out.push({ event: this.pendingEvent, data: this.pendingData.join("\n") })
          this.pendingEvent = undefined
          this.pendingData = []
        }
        continue
      }
      if (line.startsWith(":")) continue
      const colon = line.indexOf(":")
      const field = colon < 0 ? line : line.slice(0, colon)
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "")
      if (field === "event") this.pendingEvent = value
      else if (field === "data") this.pendingData.push(value)
    }
    return out
  }

  isDone(data: string): boolean {
    return data.trim() === DONE
  }
}
