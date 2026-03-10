import { describe, expect, it } from "vitest"

import { deriveSetupBootstrapRequirements } from "../src/lib/setup/requirements"

describe("setup bootstrap requirements", () => {
  it("requires admin password when no saved hash exists", () => {
    expect(deriveSetupBootstrapRequirements({
      wantsTailscaleLockdown: false,
      isTailnet: false,
      sshExposureMode: "bootstrap",
      adminPasswordConfigured: false,
      pendingAdminPassword: "",
      hasTailscaleAuthKeyForSetup: false,
    })).toEqual({
      adminPasswordRequired: true,
      adminPasswordReady: false,
      requiresTailscaleAuthKey: false,
      requiredHostSecretsConfigured: true,
    })
  })

  it("requires tailscale auth key for tailnet or lockdown setup", () => {
    expect(deriveSetupBootstrapRequirements({
      wantsTailscaleLockdown: true,
      isTailnet: false,
      sshExposureMode: "bootstrap",
      adminPasswordConfigured: true,
      pendingAdminPassword: "",
      hasTailscaleAuthKeyForSetup: false,
    })).toMatchObject({
      requiresTailscaleAuthKey: true,
      requiredHostSecretsConfigured: false,
    })

    expect(deriveSetupBootstrapRequirements({
      wantsTailscaleLockdown: false,
      isTailnet: false,
      sshExposureMode: "tailnet",
      adminPasswordConfigured: true,
      pendingAdminPassword: "",
      hasTailscaleAuthKeyForSetup: true,
    })).toMatchObject({
      requiresTailscaleAuthKey: true,
      requiredHostSecretsConfigured: true,
    })
  })
})
