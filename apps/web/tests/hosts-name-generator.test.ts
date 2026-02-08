import { AsyncLocalStorage } from "node:async_hooks"
import { describe, expect, it, vi } from "vitest"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) => startStorage?.run(context, fn) as Promise<T>

function startContext() {
  return {
    request: new Request("http://localhost"),
    contextAfterGlobalMiddlewares: {},
    executedRequestMiddlewares: new Set(),
  }
}

describe("hosts sdk name generation", () => {
  it("generates host names from control-plane host rows without runner reads", async () => {
    vi.resetModules()
    const query = vi.fn(async (_query: unknown, payload?: { projectId?: string }) => {
      expect(payload?.projectId).toBe("p1")
      return [
        { hostName: "alpha" },
        { hostName: "bravo" },
      ]
    })
    const generateHostName = vi.fn(() => "brisk-atlas-42")

    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation: vi.fn(), action: vi.fn() }) as any,
    }))
    vi.doMock("~/sdk/project", () => ({
      requireAdminProjectAccess: vi.fn(async () => ({ role: "admin" })),
    }))
    vi.doMock("~/sdk/config/dot", () => ({
      configDotGet: vi.fn(),
      configDotSet: vi.fn(),
      configDotBatch: vi.fn(),
    }))
    vi.doMock("@clawlets/core/lib/host/host-name-generator", () => ({
      generateHostName,
    }))

    const mod = await import("~/sdk/config/hosts")
    const result = await runWithStartContext(startContext(), async () =>
      await mod.generateHostName({ data: { projectId: "p1" as any } }),
    )

    expect(result).toEqual({ host: "brisk-atlas-42" })
    expect(generateHostName).toHaveBeenCalledWith({ existingHosts: ["alpha", "bravo"] })
    expect(query).toHaveBeenCalledTimes(1)
  })
})
