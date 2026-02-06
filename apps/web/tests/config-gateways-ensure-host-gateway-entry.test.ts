import { describe, expect, it } from "vitest"

import { ensureHostGatewayEntry } from "~/sdk/config"

describe("ensureHostGatewayEntry", () => {
  it("reconciles gatewaysOrder-only state by creating gateways entry", () => {
    const hostCfg: Record<string, unknown> = { gatewaysOrder: ["maren"], gateways: {} }
    const res = ensureHostGatewayEntry({ hostCfg, gatewayId: "maren" })
    expect(res.changed).toBe(true)
    expect((hostCfg.gateways as any).maren).toEqual({})
    expect(hostCfg.gatewaysOrder).toEqual(["maren"])
  })

  it("reconciles gateways-only state by adding gatewaysOrder entry", () => {
    const hostCfg: Record<string, unknown> = { gateways: { maren: {} } }
    const res = ensureHostGatewayEntry({ hostCfg, gatewayId: "maren" })
    expect(res.changed).toBe(true)
    expect(hostCfg.gatewaysOrder).toEqual(["maren"])
    expect((hostCfg.gateways as any).maren).toEqual({})
  })

  it("is idempotent when both gatewaysOrder and gateways already contain the gateway", () => {
    const hostCfg: Record<string, unknown> = { gatewaysOrder: ["maren"], gateways: { maren: {} } }
    const res = ensureHostGatewayEntry({ hostCfg, gatewayId: "maren" })
    expect(res.changed).toBe(false)
    expect(hostCfg.gatewaysOrder).toEqual(["maren"])
    expect((hostCfg.gateways as any).maren).toEqual({})
  })

  it("rejects non-object gateways entries", () => {
    const hostCfg: Record<string, unknown> = { gatewaysOrder: ["maren"], gateways: { maren: "nope" } }
    expect(() => ensureHostGatewayEntry({ hostCfg, gatewayId: "maren" })).toThrow(/invalid gateway config/i)
  })
})

