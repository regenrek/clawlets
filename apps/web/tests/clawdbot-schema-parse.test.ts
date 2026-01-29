import { describe, expect, it, vi } from "vitest"

describe("clawdbot schema output parsing", () => {
  it("extracts JSON amid banners and noise", () => {
    const nonce = "deadbeef"
    const raw = [
      "Welcome to host",
      "{ not json",
      ">>> banner {with braces}",
      "",
      `__CLAWDBOT_SCHEMA_BEGIN__${nonce}__`,
      "{\"schema\":{\"type\":\"object\"},\"version\":\"1.0.0\"}",
      `__CLAWDBOT_SCHEMA_END__${nonce}__`,
      "trailing noise {bad}",
    ].join("\n")
    return (async () => {
      const { __test_extractJsonBlock } = await import("~/server/clawdbot-schema.server")
      const extracted = __test_extractJsonBlock(raw, nonce)
      expect(JSON.parse(extracted)).toMatchObject({ version: "1.0.0" })
    })()
  })

  it("extracts JSON between markers", () => {
    const nonce = "bead1234"
    const raw = [
      "noise line",
      `__CLAWDBOT_SCHEMA_BEGIN__${nonce}__`,
      "{\"schema\":{\"type\":\"object\"},\"version\":\"1.1.0\",\"generatedAt\":\"x\",\"clawdbotRev\":\"rev\"}",
      `__CLAWDBOT_SCHEMA_END__${nonce}__`,
    ].join("\n")
    return (async () => {
      const { __test_extractJsonBlock } = await import("~/server/clawdbot-schema.server")
      const extracted = __test_extractJsonBlock(raw, nonce)
      expect(JSON.parse(extracted)).toMatchObject({ version: "1.1.0" })
    })()
  })

  it("extracts last valid JSON object", () => {
    const nonce = "feedcafe"
    const raw = [
      `__CLAWDBOT_SCHEMA_BEGIN__${nonce}__`,
      "{\"schema\":{\"type\":\"object\"},\"version\":\"2.0.0\"}",
      `__CLAWDBOT_SCHEMA_END__${nonce}__`,
    ].join("\n")
    return (async () => {
      const { __test_extractJsonBlock } = await import("~/server/clawdbot-schema.server")
      const extracted = __test_extractJsonBlock(raw, nonce)
      expect(JSON.parse(extracted)).toMatchObject({ version: "2.0.0" })
    })()
  })

  it("rejects nested lookalike without markers", () => {
    const nonce = "c0ffee01"
    const raw = [
      "log line",
      "{\"message\":\"nested {\\\"schema\\\":{\\\"type\\\":\\\"object\\\"},\\\"version\\\":\\\"x\\\",\\\"generatedAt\\\":\\\"x\\\",\\\"clawdbotRev\\\":\\\"rev\\\"}\"}",
    ].join("\n")
    return (async () => {
      const { __test_extractJsonBlock } = await import("~/server/clawdbot-schema.server")
      expect(() => __test_extractJsonBlock(raw, nonce)).toThrow("missing schema markers in output")
    })()
  })

  it("ignores marker-like strings embedded in output", () => {
    const nonce = "badc0de1"
    const raw = [
      "noise __CLAWDBOT_SCHEMA_BEGIN__badc0de1__ noise",
      "{\"schema\":{\"type\":\"object\"},\"version\":\"3.0.0\"}",
      "noise __CLAWDBOT_SCHEMA_END__badc0de1__ noise",
    ].join("\n")
    return (async () => {
      const { __test_extractJsonBlock } = await import("~/server/clawdbot-schema.server")
      expect(() => __test_extractJsonBlock(raw, nonce)).toThrow("missing schema markers in output")
    })()
  })

  it("rejects JSON missing schema fields", async () => {
    vi.resetModules()
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce12", "utf8"),
    }))
    const sshCapture = async () =>
      [
        "__CLAWDBOT_SCHEMA_BEGIN__6e6f6e63653132__",
        "{\"ok\":true}",
        "__CLAWDBOT_SCHEMA_END__6e6f6e63653132__",
      ].join("\n")
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({}) as any,
    }))
    vi.doMock("~/sdk/repo-root", () => ({
      getRepoRoot: async () => "/tmp",
    }))
    vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
      loadClawdletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1" } },
          fleet: { bots: { bot1: {} } },
        },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/clawdbot-config-invariants", () => ({
      buildClawdbotBotConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
    const res = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.message).toContain("schema payload missing required fields")
    }
  })

  it("rejects non-object schema field", async () => {
    vi.resetModules()
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce34", "utf8"),
    }))
    const sshCapture = async () =>
      [
        "__CLAWDBOT_SCHEMA_BEGIN__6e6f6e63653334__",
        "{\"schema\":[],\"version\":\"1\",\"generatedAt\":\"x\",\"clawdbotRev\":\"rev\"}",
        "__CLAWDBOT_SCHEMA_END__6e6f6e63653334__",
      ].join("\n")
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({}) as any,
    }))
    vi.doMock("~/sdk/repo-root", () => ({
      getRepoRoot: async () => "/tmp",
    }))
    vi.doMock("@clawdlets/core/lib/clawdlets-config", () => ({
      loadClawdletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1" } },
          fleet: { bots: { bot1: {} } },
        },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/clawdbot-config-invariants", () => ({
      buildClawdbotBotConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawdlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
    const res = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.message).toContain("schema payload missing required fields")
    }
  })
})
