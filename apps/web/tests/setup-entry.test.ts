import { describe, expect, it } from "vitest"
import { resolveSetupHost, RUNNER_SETUP_PLACEHOLDER_HOST } from "../src/lib/setup/setup-entry"

describe("setup entry host resolution", () => {
  it("returns first host in stable sorted order when hosts exist", () => {
    const resolved = resolveSetupHost(["zeta", "alpha", "bravo"])
    expect(resolved).toBe("alpha")
  })

  it("returns runner setup placeholder when hosts list is empty", () => {
    const resolved = resolveSetupHost([])
    expect(resolved).toBe(RUNNER_SETUP_PLACEHOLDER_HOST)
  })
})
