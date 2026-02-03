import { describe, expect, it } from "vitest"

import { ensureHostBotEntry } from "~/sdk/config-bots"

describe("ensureHostBotEntry", () => {
  it("reconciles botsOrder-only state by creating bots entry", () => {
    const hostCfg: Record<string, unknown> = { botsOrder: ["maren"], bots: {} }
    const res = ensureHostBotEntry({ hostCfg, botId: "maren" })
    expect(res.changed).toBe(true)
    expect((hostCfg.bots as any).maren).toEqual({})
    expect(hostCfg.botsOrder).toEqual(["maren"])
  })

  it("reconciles bots-only state by adding botsOrder entry", () => {
    const hostCfg: Record<string, unknown> = { bots: { maren: {} } }
    const res = ensureHostBotEntry({ hostCfg, botId: "maren" })
    expect(res.changed).toBe(true)
    expect(hostCfg.botsOrder).toEqual(["maren"])
    expect((hostCfg.bots as any).maren).toEqual({})
  })

  it("is idempotent when both botsOrder and bots already contain the bot", () => {
    const hostCfg: Record<string, unknown> = { botsOrder: ["maren"], bots: { maren: {} } }
    const res = ensureHostBotEntry({ hostCfg, botId: "maren" })
    expect(res.changed).toBe(false)
    expect(hostCfg.botsOrder).toEqual(["maren"])
    expect((hostCfg.bots as any).maren).toEqual({})
  })

  it("rejects non-object bots entries", () => {
    const hostCfg: Record<string, unknown> = { botsOrder: ["maren"], bots: { maren: "nope" } }
    expect(() => ensureHostBotEntry({ hostCfg, botId: "maren" })).toThrow(/invalid bot config/i)
  })
})

