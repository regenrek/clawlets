import { describe, expect, it, vi } from "vitest"

describe("clawdbot schema status cache", () => {
  it("reuses cached result within TTL", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    let callCount = 0
    const fetchSpy = vi.fn(async () => {
      callCount += 1
      return {
        ok: true as const,
        info: { rev: `rev-main-${callCount}` },
        sourceUrl: "https://example.com",
      }
    })
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({}) as any,
    }))
    vi.doMock("~/sdk/repo-root", () => ({
      getRepoRoot: async (_client: unknown, projectId: string) => `/tmp/${projectId}`,
    }))
    vi.doMock("@clawdlets/core/lib/nix-clawdbot", async () => {
      const actual = await vi.importActual<typeof import("@clawdlets/core/lib/nix-clawdbot")>(
        "@clawdlets/core/lib/nix-clawdbot",
      )
      return {
        ...actual,
        fetchNixClawdbotSourceInfo: fetchSpy,
        getNixClawdbotRevFromFlakeLock: () => "pin-a",
      }
    })
    const { fetchClawdbotSchemaStatus } = await import("~/server/clawdbot-schema.server")
    const first = await fetchClawdbotSchemaStatus({ projectId: "p1" as any })
    const callsAfterFirst = fetchSpy.mock.calls.length
    const second = await fetchClawdbotSchemaStatus({ projectId: "p1" as any })
    expect(first).toEqual(second)
    expect(callsAfterFirst).toBeGreaterThanOrEqual(2)
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst)
    vi.useRealTimers()
  })

  it("isolates cache per project", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    let callCount = 0
    const fetchSpy = vi.fn(async () => {
      callCount += 1
      return {
        ok: true as const,
        info: { rev: `rev-${callCount}` },
        sourceUrl: "https://example.com",
      }
    })
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({}) as any,
    }))
    vi.doMock("~/sdk/repo-root", () => ({
      getRepoRoot: async (_client: unknown, projectId: string) => `/tmp/${projectId}`,
    }))
    vi.doMock("@clawdlets/core/lib/nix-clawdbot", async () => {
      const actual = await vi.importActual<typeof import("@clawdlets/core/lib/nix-clawdbot")>(
        "@clawdlets/core/lib/nix-clawdbot",
      )
      return {
        ...actual,
        fetchNixClawdbotSourceInfo: fetchSpy,
        getNixClawdbotRevFromFlakeLock: (repoRoot: string) => {
          return repoRoot.includes("p1") ? "pin-a" : "pin-b"
        },
      }
    })
    const { fetchClawdbotSchemaStatus } = await import("~/server/clawdbot-schema.server")
    const first = await fetchClawdbotSchemaStatus({ projectId: "p1" as any })
    const second = await fetchClawdbotSchemaStatus({ projectId: "p2" as any })
    expect(first.ok && second.ok ? first.pinned?.nixClawdbotRev !== second.pinned?.nixClawdbotRev : false).toBe(true)
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    vi.useRealTimers()
  })
})
