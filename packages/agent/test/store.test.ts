import { describe, expect, test } from "bun:test"
import { SessionStore } from "../src/store.ts"

describe("store", () => {
  test("create, append, get, list roundtrip", () => {
    const store = new SessionStore(":memory:")
    try {
      const session = store.create("hello")
      store.append(session.id, "user", "hi")
      store.append(session.id, "assistant", "hello back")
      const loaded = store.get(session.id)
      expect(loaded?.messages.map((m) => [m.role, m.content])).toEqual([
        ["user", "hi"],
        ["assistant", "hello back"],
      ])
      expect(store.list()).toHaveLength(1)
      expect(store.list()[0]?.title).toBe("hello")
      expect(store.get("ses_missing")).toBeUndefined()
    } finally {
      store.close()
    }
  })
})
