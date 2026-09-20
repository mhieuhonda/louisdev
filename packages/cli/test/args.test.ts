import { describe, expect, test } from "bun:test"
import { helpText, parseArgs } from "../src/args.ts"

describe("args", () => {
  test("parses chat with message and flags", () => {
    const parsed = parseArgs(["chat", "hello", "world", "--session", "abc", "--auto-approve"])
    expect(parsed.command).toBe("chat")
    expect(parsed.positional).toEqual(["hello", "world"])
    expect(parsed.session).toBe("abc")
    expect(parsed.autoApprove).toBe(true)
  })

  test("defaults to help, understands version aliases", () => {
    expect(parseArgs([]).command).toBe("help")
    expect(parseArgs(["-v"]).command).toBe("version")
    expect(parseArgs(["--help"]).command).toBe("help")
  })

  test("rejects unknown commands and flags", () => {
    expect(() => parseArgs(["frobnicate"])).toThrow("unknown command")
    expect(() => parseArgs(["chat", "--yolo"])).toThrow("unknown flag")
    expect(() => parseArgs(["chat", "--session"])).toThrow("needs a value")
  })

  test("help text mentions commands", () => {
    expect(helpText()).toContain("louisdev quota")
  })
})
