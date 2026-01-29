import { describe, expect, it, vi } from "vitest"

describe("clawdbot live schema cache", () => {
  it("caches live schema per host/bot", async () => {
    vi.useFakeTimers()
    const sshCapture = vi.fn(async () => `{"schema":{"type":"object"},"version":"1.0.0","generatedAt":"x","clawdbotRev":"rev"}`)
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
    const first = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    const second = await fetchClawdbotSchemaLive({ projectId: "p1" as any, host: "h1", botId: "bot1" })
    expect(first).toEqual(second)
    expect(sshCapture).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
