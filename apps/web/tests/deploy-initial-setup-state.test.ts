import { describe, expect, it } from "vitest"
import { deriveInfrastructureGate, deriveInstallCardStatus } from "../src/components/deploy/deploy-initial-setup-state"

describe("deploy initial setup state", () => {
  it("blocks predeploy when the active Hetzner key is missing", () => {
    const gate = deriveInfrastructureGate({
      runnerOnline: true,
      hasActiveHcloudToken: false,
      infrastructure: {
        serverType: "cpx22",
        location: "nbg1",
      },
    })

    expect(gate.ready).toBe(false)
    expect(gate.blocked).toBe(true)
    expect(gate.message).toBe("Missing active Hetzner API key. Add one in Hetzner Setup.")
  })

  it("treats a first deploy without terraform state as not-created-yet", () => {
    const status = deriveInstallCardStatus({
      infraExists: false,
      infraMissingDetail: null,
      bootstrapInProgress: false,
      predeployState: "idle",
      predeployReady: false,
      predeployError: null,
      deployStatusReason: "Missing active Hetzner API key. Add one in Hetzner Setup.",
      hadSuccessfulBootstrap: false,
    })

    expect(status).toBe("Infrastructure not created yet. Run predeploy, then deploy to create it.")
  })

  it("keeps destroyed-infra messaging after a successful bootstrap", () => {
    const status = deriveInstallCardStatus({
      infraExists: false,
      infraMissingDetail: "missing: terraform.tfstate",
      bootstrapInProgress: false,
      predeployState: "idle",
      predeployReady: false,
      predeployError: null,
      deployStatusReason: null,
      hadSuccessfulBootstrap: true,
    })

    expect(status).toBe("Infrastructure missing. missing: terraform.tfstate")
  })
})
