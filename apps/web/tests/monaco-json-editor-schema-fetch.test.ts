import { describe, expect, it, vi } from "vitest"

type FetchResponse = { ok: boolean; status: number; text: () => Promise<string> }

describe("monaco schema fetch safety", () => {
  it("blocks cross-origin schema fetch", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.com" },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    vi.stubGlobal("fetch", vi.fn())
    const { __test_schemaRequestService } = await import("~/components/editor/monaco-json-editor")
    await expect(__test_schemaRequestService("https://evil.example.com/schema.json")).rejects.toThrow(
      "schema fetch blocked by origin policy",
    )
  })

  it("blocks origin prefix bypasses", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.com" },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    vi.stubGlobal("fetch", vi.fn())
    const { __test_schemaRequestService } = await import("~/components/editor/monaco-json-editor")
    await expect(__test_schemaRequestService("https://app.example.com.evil.com/schema.json")).rejects.toThrow(
      "schema fetch blocked by origin policy",
    )
    await expect(__test_schemaRequestService("https://app.example.com@evil.com/schema.json")).rejects.toThrow(
      "schema fetch blocked by origin policy",
    )
  })

  it("enforces timeout + size limit", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.com" },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    const fetchMock = vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
      return new Promise<FetchResponse>((resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        }
        resolve({
          ok: true,
          status: 200,
          text: async () => "x".repeat(600 * 1024),
        })
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { __test_schemaRequestService } = await import("~/components/editor/monaco-json-editor")
    await expect(__test_schemaRequestService("https://app.example.com/schema.json")).rejects.toThrow()
  })
})
