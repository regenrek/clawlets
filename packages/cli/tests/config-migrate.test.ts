import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, it, expect, vi } from "vitest";

function writeV6Config(repoRoot: string, secret: string): void {
  const config = {
    schemaVersion: 6,
    defaultHost: "clawdbot-fleet-host",
    baseFlake: "",
    fleet: {
      envSecrets: {},
      bots: ["maren"],
      botOverrides: {
        maren: {
          passthrough: {
            channels: {
              discord: {
                enabled: true,
                token: secret,
              },
            },
          },
        },
      },
      routingOverrides: {},
      guildId: "",
      codex: { enable: false, bots: [] },
      backups: { restic: { enable: false, repository: "" } },
    },
    hosts: {
      "clawdbot-fleet-host": {
        enable: false,
        diskDevice: "/dev/sda",
        sshAuthorizedKeys: [],
        sshKnownHosts: [],
        flakeHost: "",
        hetzner: { serverType: "cx43", image: "", location: "nbg1" },
        provisioning: { adminCidr: "", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
        sshExposure: { mode: "tailnet" },
        tailnet: { mode: "tailscale" },
        cache: {
          garnix: {
            private: {
              enable: true,
              netrcSecret: "garnix_netrc",
              netrcPath: "/etc/nix/netrc",
              narinfoCachePositiveTtl: 3600,
            },
          },
        },
        operator: { deploy: { enable: false } },
        selfUpdate: { enable: false, manifestUrl: "", interval: "30min", publicKey: "", signatureUrl: "" },
        agentModelPrimary: "zai/glm-4.7",
      },
    },
  };

  fs.mkdirSync(path.join(repoRoot, "fleet"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "fleet", "clawdlets.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
}

describe("config migrate-v6-to-v7", () => {
  it("suppresses dry-run output by default and warns", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-cli-config-"));
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "flake.nix"), "{ }\n", "utf8");
    writeV6Config(repoRoot, "SUPER_SECRET_TOKEN");

    const logs: string[] = [];
    const errs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.join(" "));
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
      errs.push(args.join(" "));
    });

    const prev = process.cwd();
    try {
      process.chdir(repoRoot);
      const { config } = await import("../src/commands/config");
      await config.subCommands["migrate-v6-to-v7"].run({ args: { "dry-run": true } as any });
    } finally {
      process.chdir(prev);
      logSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(errs.join("\n")).toMatch(/dry-run output suppressed/i);
    const joined = logs.join("\n");
    expect(joined).toMatch(/botCount/);
    expect(joined).not.toContain("SUPER_SECRET_TOKEN");
  });

  it("prints full config when --print is set", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-cli-config-"));
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "flake.nix"), "{ }\n", "utf8");
    writeV6Config(repoRoot, "SUPER_SECRET_TOKEN");

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.join(" "));
    });

    const prev = process.cwd();
    try {
      process.chdir(repoRoot);
      const { config } = await import("../src/commands/config");
      await config.subCommands["migrate-v6-to-v7"].run({ args: { "dry-run": true, print: true } as any });
    } finally {
      process.chdir(prev);
      logSpy.mockRestore();
    }

    const joined = logs.join("\n");
    expect(joined).toContain("SUPER_SECRET_TOKEN");
  });
});
