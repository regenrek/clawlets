import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { capture } from "@clawdbot/clawdlets-core/lib/run";
import { loadStack, loadStackEnv, resolveStackBaseFlake } from "@clawdbot/clawdlets-core/stack";
import { expandPath } from "@clawdbot/clawdlets-core/lib/path-expand";

type Check = { status: "ok" | "warn" | "missing"; label: string; detail?: string };

export const doctor = defineCommand({
  meta: {
    name: "doctor",
    description: "Validate local stack/env for deploying a host.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: bots01).", default: "bots01" },
  },
  async run({ args }) {
    const checks: Check[] = [];
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const baseResolved = await resolveStackBaseFlake({ repoRoot: layout.repoRoot, stack });
    const hostName = String(args.host || "bots01").trim() || "bots01";
    const host = stack.hosts[hostName];
    if (!host) throw new Error(`unknown host: ${hostName}`);

    checks.push({ status: "ok", label: "repo root", detail: layout.repoRoot });
    checks.push({ status: "ok", label: "stack file", detail: layout.stackFile });
    checks.push({ status: baseResolved.flake ? "ok" : "warn", label: "base flake", detail: baseResolved.flake ?? "(unset; inferred from origin if present)" });
    checks.push({ status: host.targetHost ? "ok" : "missing", label: "targetHost", detail: host.targetHost });
    checks.push({ status: host.hetzner.serverType ? "ok" : "missing", label: "hetzner.serverType", detail: host.hetzner.serverType });

    const envLoaded = loadStackEnv({ cwd: process.cwd(), stackDir: args.stackDir, envFile: stack.envFile });
    checks.push({
      status: envLoaded.envFile ? "ok" : "warn",
      label: "env file",
      detail: envLoaded.envFile ?? "(none)",
    });
    checks.push({
      status: envLoaded.env.HCLOUD_TOKEN ? "ok" : "missing",
      label: "HCLOUD_TOKEN",
      detail: envLoaded.env.HCLOUD_TOKEN ? "(set)" : undefined,
    });
    checks.push({
      status: envLoaded.env.GITHUB_TOKEN ? "ok" : "warn",
      label: "GITHUB_TOKEN",
      detail: envLoaded.env.GITHUB_TOKEN ? "(set)" : "(optional; required only for private base repo)",
    });

    const sshPubkeyFile = expandPath(host.terraform.sshPubkeyFile);
    checks.push({
      status: fs.existsSync(sshPubkeyFile) ? "ok" : "missing",
      label: "ssh pubkey file",
      detail: sshPubkeyFile,
    });

    checks.push({
      status: host.secrets.localFile ? "ok" : "missing",
      label: "secrets.localFile",
      detail: host.secrets.localFile,
    });

    const nixBin = envLoaded.env.NIX_BIN || "nix";
    try {
      const v = await capture(nixBin, ["--version"], { cwd: layout.repoRoot });
      checks.push({ status: "ok", label: "nix", detail: v });
    } catch {
      checks.push({ status: "missing", label: "nix", detail: `(${nixBin} not found)` });
    }

    for (const c of checks) {
      console.log(`${c.status}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
    }

    if (checks.some((c) => c.status === "missing")) process.exitCode = 1;

    const ignorePath = path.join(layout.repoRoot, ".gitignore");
    if (fs.existsSync(ignorePath)) {
      const gitignore = fs.readFileSync(ignorePath, "utf8");
      if (!gitignore.split("\n").some((l) => l.trim() === ".clawdlets/")) {
        console.log(`warn: .gitignore missing '.clawdlets/' (recommended)`);
      }
    }
  },
});
