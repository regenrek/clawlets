import { describe, expect, it } from "vitest"
import {
  maskProjectToken,
  parseProjectTokenKeyring,
  resolveActiveProjectTokenEntry,
  serializeProjectTokenKeyring,
} from "../src/lib/project-token-keyring"

describe("project token keyring", () => {
  it("parses valid keyring JSON and drops invalid rows", () => {
    const parsed = parseProjectTokenKeyring(JSON.stringify({
      items: [
        { id: "a", label: "Alpha", value: "token-a" },
        { id: "a", label: "Duplicate", value: "token-dup" },
        { id: "", label: "Bad", value: "bad" },
        { id: "b", value: "token-b" },
      ],
    }))

    expect(parsed.items.map((row) => row.id)).toEqual(["a", "b"])
    expect(parsed.items[1]?.label).toContain("Key")
  })

  it("resolves active entry and falls back to first item", () => {
    const keyring = parseProjectTokenKeyring(JSON.stringify({
      items: [
        { id: "a", label: "A", value: "value-a" },
        { id: "b", label: "B", value: "value-b" },
      ],
    }))

    expect(resolveActiveProjectTokenEntry({ keyring, activeId: "b" })?.id).toBe("b")
    expect(resolveActiveProjectTokenEntry({ keyring, activeId: "missing" })?.id).toBe("a")
  })

  it("serializes normalized items and masks sensitive values for UI", () => {
    const keyring = parseProjectTokenKeyring(JSON.stringify({
      items: [{ id: "a", label: "", value: "tskey-auth-1234567890" }],
    }))
    const serialized = serializeProjectTokenKeyring(keyring)

    expect(serialized).toContain('"items"')
    expect(maskProjectToken("tskey-auth-1234567890")).toBe("tske******7890")
  })
})
