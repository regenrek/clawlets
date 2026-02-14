import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findRepoRootMock = vi.hoisted(() => vi.fn());
const loadFullConfigMock = vi.hoisted(() => vi.fn());
const writeClawletsConfigMock = vi.hoisted(() => vi.fn());
const updateDeployCredsEnvFileMock = vi.hoisted(() => vi.fn());
const runMock = vi.hoisted(() => vi.fn());
const captureMock = vi.hoisted(() => vi.fn());

vi.mock("@clawlets/core/lib/project/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawlets/core/lib/config/clawlets-config", () => ({
  ClawletsConfigSchema: {
    parse: (value: unknown) => value,
  },
  loadFullConfig: loadFullConfigMock,
  writeClawletsConfig: writeClawletsConfigMock,
}));

vi.mock("@clawlets/core/lib/infra/deploy-creds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clawlets/core/lib/infra/deploy-creds")>();
  return {
    ...actual,
    updateDeployCredsEnvFile: updateDeployCredsEnvFileMock,
  };
});

vi.mock("@clawlets/core/lib/runtime/run", () => ({
  run: runMock,
  capture: captureMock,
}));

describe("setup apply command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies config + deploy creds + secrets in order and prints redacted summary", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-setup-apply-"));
    const configPath = path.join(repoRoot, "clawlets.config.json");
    const inputPath = path.join(repoRoot, "setup-input.json");
    const order: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      findRepoRootMock.mockReturnValue(repoRoot);
      loadFullConfigMock.mockReturnValue({
        config: { hosts: { alpha: {} }, fleet: {} },
        infraConfigPath: configPath,
      });
      writeClawletsConfigMock.mockImplementation(async () => {
        order.push("config");
      });
      updateDeployCredsEnvFileMock.mockImplementation(async () => {
        order.push("deployCreds");
        return { updatedKeys: ["HCLOUD_TOKEN", "GITHUB_TOKEN"] };
      });
      runMock.mockImplementation(async () => {
        order.push("secretsInit");
      });
      captureMock.mockImplementation(async () => {
        order.push("secretsVerify");
        return JSON.stringify({
          results: [{ status: "ok" }, { status: "missing" }, { status: "warn" }],
        });
      });

      fs.writeFileSync(
        inputPath,
        JSON.stringify(
          {
            hostName: "alpha",
            configOps: [
              { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
            ],
            deployCreds: {
              HCLOUD_TOKEN: "token-123",
              GITHUB_TOKEN: "gh-123",
              NOPE: "ignored",
            },
            bootstrapSecrets: {
              adminPasswordHash: "$6$hash",
              tailscaleAuthKey: "tskey-auth",
              discord_token: "discord-raw",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const { setup } = await import("../src/commands/setup/index.js");
      const apply = (setup as any).subCommands?.apply;
      await apply.run({ args: { fromJson: inputPath, json: true } } as any);

      expect(order).toEqual(["config", "deployCreds", "secretsInit", "secretsVerify"]);
      expect(writeClawletsConfigMock).toHaveBeenCalledTimes(1);
      expect(updateDeployCredsEnvFileMock).toHaveBeenCalledTimes(1);
      expect(runMock).toHaveBeenCalledTimes(1);
      expect(captureMock).toHaveBeenCalledTimes(1);
      const summaryRaw = String(logSpy.mock.calls.at(-1)?.[0] || "");
      const summary = JSON.parse(summaryRaw) as Record<string, unknown>;
      expect(summaryRaw).not.toContain("token-123");
      expect(summaryRaw).not.toContain("gh-123");
      expect(summaryRaw).not.toContain("discord-raw");
      expect((summary as any).ok).toBe(true);
      expect((summary as any).bootstrapSecrets?.verify).toEqual({
        ok: 1,
        missing: 1,
        warn: 1,
        total: 3,
      });
    } finally {
      logSpy.mockRestore();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails when payload has no recognized deploy creds keys", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-setup-apply-fail-"));
    const configPath = path.join(repoRoot, "clawlets.config.json");
    const inputPath = path.join(repoRoot, "setup-input.json");
    try {
      findRepoRootMock.mockReturnValue(repoRoot);
      loadFullConfigMock.mockReturnValue({
        config: { hosts: { alpha: {} }, fleet: {} },
        infraConfigPath: configPath,
      });
      fs.writeFileSync(
        inputPath,
        JSON.stringify(
          {
            hostName: "alpha",
            configOps: [
              { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
            ],
            deployCreds: {
              NOT_ALLOWED: "x",
            },
            bootstrapSecrets: {
              adminPasswordHash: "$6$hash",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const { setup } = await import("../src/commands/setup/index.js");
      const apply = (setup as any).subCommands?.apply;
      await expect(apply.run({ args: { fromJson: inputPath, json: true } } as any)).rejects.toThrow(
        /no recognized deploy creds keys/i,
      );
      expect(updateDeployCredsEnvFileMock).not.toHaveBeenCalled();
      expect(runMock).not.toHaveBeenCalled();
      expect(captureMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not inject tailscaleAuthKey when missing from payload", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-setup-apply-keyring-"));
    const configPath = path.join(repoRoot, "clawlets.config.json");
    const inputPath = path.join(repoRoot, "setup-input.json");
    let submittedSecretsBody: Record<string, unknown> | null = null;
    try {
      findRepoRootMock.mockReturnValue(repoRoot);
      loadFullConfigMock.mockReturnValue({
        config: { hosts: { alpha: {} }, fleet: {} },
        infraConfigPath: configPath,
      });
      updateDeployCredsEnvFileMock.mockResolvedValue({
        updatedKeys: ["SOPS_AGE_KEY_FILE"],
      });
      runMock.mockImplementation(async (_cmd, args: string[]) => {
        const fromJsonIndex = args.indexOf("--from-json");
        if (fromJsonIndex < 0) return;
        const secretsPath = String(args[fromJsonIndex + 1] || "");
        submittedSecretsBody = JSON.parse(fs.readFileSync(secretsPath, "utf8")) as Record<string, unknown>;
      });
      captureMock.mockResolvedValue(
        JSON.stringify({
          results: [{ status: "ok" }],
        }),
      );

      fs.writeFileSync(
        inputPath,
        JSON.stringify(
          {
            hostName: "alpha",
            configOps: [
              { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
            ],
            deployCreds: {
              SOPS_AGE_KEY_FILE: ".clawlets/keys/operators/alice.agekey",
            },
            bootstrapSecrets: {
              adminPasswordHash: "$6$hash",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const { setup } = await import("../src/commands/setup/index.js");
      const apply = (setup as any).subCommands?.apply;
      await apply.run({ args: { fromJson: inputPath, json: true } } as any);
      expect(submittedSecretsBody?.tailscaleAuthKey).toBeUndefined();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
