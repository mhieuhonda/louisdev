import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ApprovalNeededError, BashTool, EditTool, isBlockedCommand, ReadTool } from "../src/tools.ts"

function workdir(): string {
  return mkdtempSync(join(tmpdir(), "louisdev-tools-"))
}

describe("tools", () => {
  test("read inside workdir, missing file errors", async () => {
    const dir = workdir()
    await Bun.write(join(dir, "a.txt"), "hello")
    const ctx = { workdir: dir, autoApprove: false }
    expect(await ReadTool.execute({ path: "a.txt" }, ctx)).toBe("hello")
    await expect(ReadTool.execute({ path: "nope.txt" }, ctx)).rejects.toThrow("not found")
    await expect(ReadTool.execute({ path: "../escape.txt" }, ctx)).rejects.toThrow("outside workdir")
  })

  test("edit needs approval, enforces single match", async () => {
    const dir = workdir()
    await Bun.write(join(dir, "a.txt"), "one two one")
    const denied = { workdir: dir, autoApprove: false }
    await expect(
      EditTool.execute({ path: "a.txt", oldText: "one", newText: "1" }, denied),
    ).rejects.toBeInstanceOf(ApprovalNeededError)
    const ctx = { workdir: dir, autoApprove: true }
    await expect(EditTool.execute({ path: "a.txt", oldText: "one", newText: "1" }, ctx)).rejects.toThrow(
      "multiple",
    )
    expect(await EditTool.execute({ path: "a.txt", oldText: "two", newText: "2" }, ctx)).toBe("edited a.txt")
    expect(await Bun.file(join(dir, "a.txt")).text()).toBe("one 2 one")
  })

  test("bash runs, truncates, refuses dangerous commands", async () => {
    const ctx = { workdir: workdir(), autoApprove: true }
    expect(await BashTool.execute({ command: "echo hi" }, ctx)).toContain("hi")
    expect(isBlockedCommand("rm -rf /")).toBe(true)
    expect(isBlockedCommand("rm -rf ~")).toBe(true)
    expect(isBlockedCommand("echo hello")).toBe(false)
    await expect(BashTool.execute({ command: "rm -rf /" }, ctx)).rejects.toThrow("refused")
    await expect(
      BashTool.execute({ command: "echo hi" }, { ...ctx, autoApprove: false }),
    ).rejects.toBeInstanceOf(ApprovalNeededError)
  })
})
