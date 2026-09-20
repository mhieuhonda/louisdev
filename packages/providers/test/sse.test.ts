import { describe, expect, test } from "bun:test"
import { SSEParser } from "../src/sse.ts"

describe("sse", () => {
  test("parses events split across chunks", () => {
    const parser = new SSEParser()
    const first = parser.feed('data: {"a":')
    expect(first).toEqual([])
    const second = parser.feed("1}\n\ndata: [DONE]\n\n")
    expect(second).toEqual([
      { event: undefined, data: '{"a":1}' },
      { event: undefined, data: "[DONE]" },
    ])
    expect(parser.isDone(second[1]?.data ?? "")).toBe(true)
  })

  test("keeps event names and skips comments", () => {
    const parser = new SSEParser()
    const events = parser.feed(":ping\n\nevent: message\ndata: hello\n\n")
    expect(events).toEqual([{ event: "message", data: "hello" }])
  })

  test("joins multi-line data", () => {
    const parser = new SSEParser()
    const events = parser.feed("data: one\ndata: two\n\n")
    expect(events).toEqual([{ event: undefined, data: "one\ntwo" }])
  })
})
