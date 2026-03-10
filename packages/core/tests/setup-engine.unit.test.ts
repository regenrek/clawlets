import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const loadFullConfigMock = vi.hoisted(() => vi.fn())
const writeClawletsConfigMock = vi.hoisted(() => vi.fn())
const updateDeployCredsEnvFileMock = vi.hoisted(() => vi.fn())
const mkpasswdYescryptHashMock = vi.hoisted(() => vi.fn())
const runMock = vi.hoisted(() => vi.fn())
const captureMock = vi.hoisted(() => vi.fn())

vi.mock("../src/lib/config/clawlets-config", () => ({
  ClawletsConfigSchema: {
    parse: (value: unknown) => value,
  },
  loadFullConfig: loadFullConfigMock,
  writeClawletsConfig: writeClawletsConfigMock,
}))

vi.mock("../src/lib/infra/deploy-creds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/infra/deploy-creds")>()
  return {
    ...actual,
    updateDeployCredsEnvFile: updateDeployCredsEnvFileMock,
  }
})

vi.mock("../src/lib/security/mkpasswd", () => ({
  mkpasswdYescryptHash: mkpasswdYescryptHashMock,
}))

vi.mock("../src/lib/runtime/run", () => ({
  run: runMock,
  capture: captureMock,
}))

describe("setup apply engine", () => {
  let repoRoot: string
  let runtimeDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-setup-engine-repo-"))
    runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-setup-engine-runtime-"))
    fs.mkdirSync(path.join(repoRoot, "fleet"), { recursive: true })
    fs.mkdirSync(path.join(repoRoot, "secrets"), { recursive: true })
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true })
    fs.writeFileSync(path.join(repoRoot, "flake.nix"), "{}\n", "utf8")

    loadFullConfigMock.mockReturnValue({
      config: { hosts: { alpha: {} }, fleet: {} },
      infraConfigPath: path.join(repoRoot, "fleet", "clawlets.json"),
    })
    writeClawletsConfigMock.mockResolvedValue(undefined)
    updateDeployCredsEnvFileMock.mockResolvedValue({
      envPath: path.join(runtimeDir, "env"),
      runtimeDir,
      updatedKeys: ["GITHUB_TOKEN", "SOPS_AGE_KEY_FILE"],
    })
    mkpasswdYescryptHashMock.mockResolvedValue("$y$hash")
    runMock.mockResolvedValue(undefined)
    captureMock.mockResolvedValue(JSON.stringify({
      results: [{ status: "ok" }, { status: "warn" }],
    }))
  })

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true })
    fs.rmSync(runtimeDir, { recursive: true, force: true })
  })

  it("emits ordered step progress and returns a structured summary", async () => {
    const { executeSetupApplyPlan } = await import("../src/lib/setup/engine")
    const seen: string[] = []

    const result = await executeSetupApplyPlan({
      hostName: "alpha",
      configMutations: [
        { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
      ],
      deployCreds: {
        GITHUB_TOKEN: "ghp_test",
        SOPS_AGE_KEY_FILE: "/tmp/key.age",
        NIX_BIN: "nix",
      },
      bootstrapSecrets: {
        adminPassword: "pw123",
        tailscale_auth_key: "tskey-auth",
      },
    }, {
      repoRoot,
      runtimeDir,
      cliEntry: "/tmp/clawlets-cli",
      operationId: "op1",
      attempt: 1,
      onStep: async (step) => {
        seen.push(`${step.stepId}:${step.status}`)
      },
    })

    expect(result.terminal).toBe("succeeded")
    expect(result.summary.hostName).toBe("alpha")
    expect(result.summary.configUpdatedPaths).toEqual(["hosts.alpha.provisioning.provider"])
    expect(result.summary.deployCredsUpdatedKeys).toEqual(["GITHUB_TOKEN", "SOPS_AGE_KEY_FILE"])
    expect(result.summary.verifiedSecrets).toEqual({ ok: 1, missing: 0, warn: 1, total: 2 })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("ghp_test")
    expect(serialized).not.toContain("tskey-auth")
    expect(serialized).not.toContain("pw123")
    expect(seen).toEqual([
      "plan_validated:running",
      "plan_validated:succeeded",
      "workspace_staged:running",
      "workspace_staged:succeeded",
      "config_written:running",
      "config_written:succeeded",
      "deploy_creds_written:running",
      "deploy_creds_written:succeeded",
      "bootstrap_secrets_initialized:running",
      "bootstrap_secrets_initialized:succeeded",
      "bootstrap_secrets_verified:running",
      "bootstrap_secrets_verified:succeeded",
      "persist_committed:running",
      "persist_committed:succeeded",
    ])
  })

  it("fails on the bootstrap init step and surfaces the failing step", async () => {
    const { executeSetupApplyPlan } = await import("../src/lib/setup/engine")
    runMock.mockRejectedValueOnce(new Error("secrets init failed"))
    const seen: string[] = []

    await expect(executeSetupApplyPlan({
      hostName: "alpha",
      configMutations: [
        { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
      ],
      deployCreds: {
        GITHUB_TOKEN: "ghp_test",
        SOPS_AGE_KEY_FILE: "/tmp/key.age",
        NIX_BIN: "nix",
      },
      bootstrapSecrets: {
        adminPasswordHash: "$y$hash",
      },
    }, {
      repoRoot,
      runtimeDir,
      cliEntry: "/tmp/clawlets-cli",
      operationId: "op1",
      attempt: 1,
      onStep: async (step) => {
        seen.push(`${step.stepId}:${step.status}:${step.safeMessage}`)
      },
    })).rejects.toThrow(/secrets init failed/i)

    expect(seen.some((entry) => entry.startsWith("bootstrap_secrets_initialized:failed:"))).toBe(true)
    expect(captureMock).not.toHaveBeenCalled()
  })

  it("returns the same summary on repeated identical execution input", async () => {
    const { executeSetupApplyPlan } = await import("../src/lib/setup/engine")
    const input = {
      hostName: "alpha",
      configMutations: [
        { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
      ],
      deployCreds: {
        GITHUB_TOKEN: "ghp_test",
        SOPS_AGE_KEY_FILE: "/tmp/key.age",
        NIX_BIN: "nix",
      },
      bootstrapSecrets: {
        adminPasswordHash: "$y$hash",
      },
    }

    const first = await executeSetupApplyPlan(input, {
      repoRoot,
      runtimeDir,
      cliEntry: "/tmp/clawlets-cli",
      operationId: "op1",
      attempt: 1,
    })
    const second = await executeSetupApplyPlan(input, {
      repoRoot,
      runtimeDir,
      cliEntry: "/tmp/clawlets-cli",
      operationId: "op1",
      attempt: 2,
    })

    expect(first.summary).toEqual(second.summary)
    expect(first.terminal).toBe("succeeded")
    expect(second.terminal).toBe("succeeded")
  })

  it("succeeds when rerun after a previous bootstrap init failure", async () => {
    const { executeSetupApplyPlan } = await import("../src/lib/setup/engine")
    runMock.mockRejectedValueOnce(new Error("secrets init failed"))

    const input = {
      hostName: "alpha",
      configMutations: [
        { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
      ],
      deployCreds: {
        GITHUB_TOKEN: "ghp_test",
        SOPS_AGE_KEY_FILE: "/tmp/key.age",
        NIX_BIN: "nix",
      },
      bootstrapSecrets: {
        adminPasswordHash: "$y$hash",
      },
    }

    await expect(executeSetupApplyPlan(input, {
      repoRoot,
      runtimeDir,
      cliEntry: "/tmp/clawlets-cli",
      operationId: "op1",
      attempt: 1,
    })).rejects.toThrow(/secrets init failed/i)

    const rerun = await executeSetupApplyPlan(input, {
      repoRoot,
      runtimeDir,
      cliEntry: "/tmp/clawlets-cli",
      operationId: "op1",
      attempt: 2,
    })

    expect(rerun.terminal).toBe("succeeded")
  })
})
