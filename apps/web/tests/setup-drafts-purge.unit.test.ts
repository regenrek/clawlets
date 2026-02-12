import { describe, expect, it, vi } from "vitest"

import { __test_purgeExpiredInternalHandler } from "../convex/controlPlane/setupDrafts"

function makeCtx(rows: Array<{ _id: string; expiresAt: number }>) {
  const drafts = new Map(rows.map((row) => [row._id, { ...row }]))
  const deleted: string[] = []
  const ctx = {
    db: {
      query: (_table: "setupDrafts") => ({
        withIndex: (_name: string, fn: any) => {
          let lteValue = Number.POSITIVE_INFINITY
          const q: any = {
            lte: (_field: string, value: number) => {
              lteValue = value
              return q
            },
          }
          fn(q)
          return {
            take: async (limit: number) =>
              [...drafts.values()]
                .filter((row) => row.expiresAt <= lteValue)
                .slice(0, Math.max(0, Math.trunc(limit))),
          }
        },
      }),
      delete: async (id: string) => {
        deleted.push(String(id))
        drafts.delete(String(id))
      },
    },
  }
  return { ctx, deleted, drafts }
}

describe("setup drafts purge", () => {
  it("deletes only expired drafts up to limit", async () => {
    vi.useFakeTimers()
    const now = 10_000
    vi.setSystemTime(now)
    const { ctx, deleted, drafts } = makeCtx([
      { _id: "d1", expiresAt: now - 10 },
      { _id: "d2", expiresAt: now - 1 },
      { _id: "d3", expiresAt: now + 10 },
    ])

    const result = await __test_purgeExpiredInternalHandler(ctx as any, { limit: 1 })
    expect(result).toEqual({ deleted: 1 })
    expect(deleted).toHaveLength(1)
    expect(drafts.has("d3")).toBe(true)
    vi.useRealTimers()
  })
})
