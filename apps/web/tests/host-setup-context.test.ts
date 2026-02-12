import { describe, expect, it } from "vitest"
import { deriveHostSetupContextMode } from "~/lib/setup/host-setup-context"

describe("deriveHostSetupContextMode", () => {
  it("returns first_host when project has exactly one host", () => {
    expect(deriveHostSetupContextMode(1)).toBe("first_host")
  })

  it("returns host_setup for projects with zero or multiple hosts", () => {
    expect(deriveHostSetupContextMode(0)).toBe("host_setup")
    expect(deriveHostSetupContextMode(2)).toBe("host_setup")
  })
})
