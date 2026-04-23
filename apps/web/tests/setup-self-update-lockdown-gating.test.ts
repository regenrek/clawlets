import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { deriveHostSelfUpdateState } from "../src/lib/setup/self-update"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup self-update lockdown gating", () => {
  it("treats self-update as configured when enabled with baseUrls and verification", () => {
    const configured = deriveHostSelfUpdateState({
      hostCfg: {
        selfUpdate: {
          enable: true,
          baseUrls: ["https://updates.example.com"],
          publicKeys: ["minisign:abc123"],
          allowUnsigned: false,
        },
      },
    })

    expect(configured.configured).toBe(true)
  })

  it("treats self-update as unconfigured when disabled or missing trust settings", () => {
    const disabled = deriveHostSelfUpdateState({
      hostCfg: {
        selfUpdate: {
          enable: false,
          baseUrls: ["https://updates.example.com"],
          publicKeys: ["minisign:abc123"],
          allowUnsigned: false,
        },
      },
    })
    const missingTrust = deriveHostSelfUpdateState({
      hostCfg: {
        selfUpdate: {
          enable: true,
          baseUrls: ["https://updates.example.com"],
          publicKeys: [],
          allowUnsigned: false,
        },
      },
    })

    expect(disabled.configured).toBe(false)
    expect(missingTrust.configured).toBe(false)
  })

  it("lets desired metadata override stale host config for configured state", () => {
    const configuredFromDesired = deriveHostSelfUpdateState({
      hostDesired: {
        selfUpdateEnabled: true,
        selfUpdateBaseUrlCount: 1,
        selfUpdatePublicKeyCount: 0,
        selfUpdateAllowUnsigned: true,
      },
      hostCfg: {
        selfUpdate: {
          enable: false,
          baseUrls: [],
          publicKeys: [],
          allowUnsigned: false,
        },
      },
    })

    expect(configuredFromDesired.configured).toBe(true)
  })

  it("keeps deploy setup apply as a canonical lockdown-flow gate", () => {
    const deploy = readFile("components/deploy/deploy-initial-setup.tsx")

    expect(deploy).toContain("if (skipApplyAfterLockdown)")
    expect(deploy).toContain("setStepStatus(\"applyUpdates\", \"skipped\", \"selfUpdate disabled/unconfigured\")")
    expect(deploy).toContain("Lockdown completed. Updates skipped (selfUpdate disabled).")
    expect(deploy).toContain("const start = await serverUpdateApplyStart({")
  })

  it("keeps vpn activation apply behind the same self-update gate", () => {
    const vpnPanel = readFile("components/hosts/host-settings-vpn-panel.tsx")

    expect(vpnPanel).toContain("if (!selfUpdateConfigured)")
    expect(vpnPanel).toContain("const apply = await serverUpdateApplyStart({")
    expect(vpnPanel).toContain("Lockdown completed. Updates skipped (selfUpdate disabled).")
  })
})
