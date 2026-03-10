import { describe, expect, it } from "vitest"

import {
  getActiveSetupOperationStep,
  isSetupOperationTerminal,
  summarizeSetupOperation,
} from "../src/lib/setup/setup-operation-state"

describe("setup operation state helpers", () => {
  it("identifies terminal states", () => {
    expect(isSetupOperationTerminal("queued")).toBe(false)
    expect(isSetupOperationTerminal("running")).toBe(false)
    expect(isSetupOperationTerminal("succeeded")).toBe(true)
    expect(isSetupOperationTerminal("failed")).toBe(true)
  })

  it("prefers failed or running steps when summarizing operation state", () => {
    const operation = {
      _id: "op1" as any,
      status: "running" as const,
      steps: [
        { stepId: "plan_validated", status: "succeeded" as const, safeMessage: "Validated", retryable: true, updatedAt: 1 },
        { stepId: "config_written", status: "running" as const, safeMessage: "Writing config", retryable: true, updatedAt: 2 },
      ],
    }

    expect(getActiveSetupOperationStep(operation as any)?.stepId).toBe("config_written")
    expect(summarizeSetupOperation(operation as any)).toBe("Writing config")
  })

  it("uses terminal message on failed operations and success step message on succeeded operations", () => {
    const failed = {
      _id: "op1" as any,
      status: "failed" as const,
      terminalMessage: "setup apply failed",
      steps: [
        { stepId: "bootstrap_secrets_verified", status: "failed" as const, safeMessage: "Secrets verify failed", retryable: true, updatedAt: 1 },
      ],
    }
    const succeeded = {
      _id: "op2" as any,
      status: "succeeded" as const,
      steps: [
        { stepId: "persist_committed", status: "succeeded" as const, safeMessage: "Setup apply committed", retryable: false, updatedAt: 1 },
      ],
    }

    expect(summarizeSetupOperation(failed as any)).toBe("setup apply failed")
    expect(summarizeSetupOperation(succeeded as any)).toBe("Setup apply committed")
  })

  it("keeps the last succeeded step message when an operation is resumed but no step is currently running", () => {
    const resumed = {
      _id: "op3" as any,
      status: "running" as const,
      steps: [
        { stepId: "plan_validated", status: "succeeded" as const, safeMessage: "Setup apply plan validated", retryable: true, updatedAt: 1 },
        { stepId: "workspace_staged", status: "succeeded" as const, safeMessage: "Staging workspace ready", retryable: true, updatedAt: 2 },
        { stepId: "config_written", status: "pending" as const, safeMessage: "Pending", retryable: true, updatedAt: 3 },
      ],
    }

    expect(getActiveSetupOperationStep(resumed as any)?.stepId).toBe("workspace_staged")
    expect(summarizeSetupOperation(resumed as any)).toBe("Staging workspace ready")
  })
})
