import { describe, expect, it, vi, beforeEach } from "vitest";

const collectDoctorChecksMock = vi.fn();
const renderDoctorGateFailureMock = vi.fn(() => "gate failed");

vi.mock("@clawlets/core/doctor", () => ({
  collectDoctorChecks: collectDoctorChecksMock,
}));

vi.mock("../src/lib/doctor-render.js", () => ({
  renderDoctorGateFailure: renderDoctorGateFailureMock,
}));

describe("requireDeployGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes when no missing and strict=false", async () => {
    collectDoctorChecksMock.mockResolvedValue([{ status: "ok", scope: "repo", label: "ok" }]);
    const { requireDeployGate } = await import("../src/lib/deploy-gate.js");
    await expect(requireDeployGate({ host: "alpha", scope: "repo", strict: false })).resolves.toBeUndefined();
  });

  it("throws when missing checks exist", async () => {
    collectDoctorChecksMock.mockResolvedValue([{ status: "missing", scope: "repo", label: "missing" }]);
    const { requireDeployGate } = await import("../src/lib/deploy-gate.js");
    await expect(requireDeployGate({ host: "alpha", scope: "repo", strict: false })).rejects.toThrow(/gate failed/);
  });

  it("throws on warn when strict", async () => {
    collectDoctorChecksMock.mockResolvedValue([{ status: "warn", scope: "repo", label: "warn" }]);
    const { requireDeployGate } = await import("../src/lib/deploy-gate.js");
    await expect(requireDeployGate({ host: "alpha", scope: "repo", strict: true })).rejects.toThrow(/gate failed/);
  });

  it("passes lockdown scope when blockers are all ok", async () => {
    collectDoctorChecksMock.mockResolvedValue([
      { status: "ok", scope: "lockdown", label: "host.enable" },
      { status: "ok", scope: "lockdown", label: "sshExposure" },
      { status: "ok", scope: "lockdown", label: "tailnet configured" },
      { status: "ok", scope: "lockdown", label: "targetHost" },
      { status: "ok", scope: "lockdown", label: "deploy env file" },
      { status: "ok", scope: "lockdown", label: "provider credentials" },
      { status: "ok", scope: "lockdown", label: "infra state" },
    ]);
    const { requireDeployGate } = await import("../src/lib/deploy-gate.js");
    await expect(requireDeployGate({ host: "alpha", scope: "lockdown", strict: true })).resolves.toBeUndefined();
  });

  it("fails lockdown scope on true blocker", async () => {
    collectDoctorChecksMock.mockResolvedValue([{ status: "missing", scope: "lockdown", label: "infra state" }]);
    const { requireDeployGate } = await import("../src/lib/deploy-gate.js");
    await expect(requireDeployGate({ host: "alpha", scope: "lockdown", strict: true })).rejects.toThrow(/gate failed/);
  });
});
