import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { runSetup } from "@clawdbot/clawdlets-core/setup";
import { getHostNixPath, getRepoLayout } from "@clawdbot/clawdlets-core/repo-layout";
import { parseBotsFromFleetNix } from "@clawdbot/clawdlets-core/lib/fleet";
import { upsertAdminAuthorizedKey } from "@clawdbot/clawdlets-core/lib/nix-host";
import { expandPath } from "@clawdbot/clawdlets-core/lib/path-expand";
import { findRepoRoot } from "@clawdbot/clawdlets-core/lib/repo";
import { looksLikeSshKeyContents } from "@clawdbot/clawdlets-core/lib/ssh";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../lib/wizard.js";

async function cancelOrBack(params: { flow: string; canBack: boolean }): Promise<"back" | "exit"> {
  const nav = await navOnCancel(params);
  if (nav === NAV_EXIT) {
    cancelFlow();
    return "exit";
  }
  return "back";
}

function validateNonEmpty(name: string, value: string): string | undefined {
  if (!value.trim()) return `${name} is required`;
  return undefined;
}

function validateAdminCidr(value: string): string | undefined {
  const v = value.trim();
  // minimal sanity: ipv4/32 or ipv4/cidr
  if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(v)) return "expected IPv4 CIDR (example: 203.0.113.10/32)";
  const [ip, bitsRaw] = v.split("/");
  const bits = Number(bitsRaw);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return "invalid CIDR bits (0-32)";
  const octets = ip!.split(".").map((x) => Number(x));
  if (octets.length !== 4 || octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return "invalid IPv4 address";
  }
  return undefined;
}

function resolveDefaultSshPubkeyFile(): string | null {
  const candidates = [
    path.join(os.homedir(), ".ssh", "id_ed25519.pub"),
    path.join(os.homedir(), ".ssh", "id_rsa.pub"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export const setup = defineCommand({
  meta: {
    name: "setup",
    description: "Interactive onboarding (env + sops + secrets) before bootstrap.",
  },
  args: {
    envFile: {
      type: "string",
      description: "Path to .env file (default: repo root .env if present).",
    },
    host: {
      type: "string",
      description: "Host name / secrets file base (default: bots01).",
      default: "bots01",
    },
    dryRun: {
      type: "boolean",
      description: "Print planned actions without writing files.",
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (!process.stdout.isTTY) {
        throw new Error("setup requires a TTY (interactive prompts)");
      }

      const cwd = process.cwd();
      const repoRoot = findRepoRoot(cwd);
      const host = String(args.host || "bots01").trim() || "bots01";
      const envFile = args.envFile ? path.resolve(cwd, args.envFile) : path.join(repoRoot, ".env");
      const layout = getRepoLayout(repoRoot);

      p.intro("clawdlets setup");
      p.note(
        [
          "HCLOUD_TOKEN: Hetzner Cloud Console → Security → API Tokens (https://console.hetzner.cloud/)",
          "ADMIN_CIDR: your public IPv4 CIDR, usually <your-ip>/32 (example: 203.0.113.10/32)",
          "Tip: curl -4 https://ifconfig.me  # then add /32",
          "GITHUB_TOKEN: only if base flake repo is private. Create fine-grained PAT at https://github.com/settings/personal-access-tokens/new",
          "- Repo access: only select the flake repo",
          "- Repo permissions: Contents = Read-only",
        ].join("\n"),
        "Inputs",
      );
      p.note(
        [
          "Creates/updates local files only:",
          `- ${path.relative(repoRoot, envFile)}`,
          `- ${path.relative(repoRoot, layout.sopsConfigPath)}`,
          `- ${path.relative(repoRoot, path.join(layout.secretsDir, `${host}.yaml`))} (encrypted)`,
          `- ${path.relative(repoRoot, path.join(layout.secretsHostsDir, `${host}.agekey`))} (+ .pub)`,
          `- ${path.relative(repoRoot, path.join(layout.secretsOperatorsDir, "<you>.agekey"))} (+ .pub)`,
          `- ${path.relative(repoRoot, path.join(layout.secretsDir, "extra-files", host, "var/lib/sops-nix/key.txt"))}`,
          "",
          "Optionally updates:",
          `- ${path.relative(repoRoot, getHostNixPath(layout, host))} (authorizedKeys / bootstrapSsh)`,
          "",
          "Safe defaults:",
          "- never prints secrets",
          "- creates timestamped backups on overwrite",
          "- run with --dryRun first",
        ].join("\n"),
        "What this does",
      );

      const defaultSshPubkey =
        process.env.SSH_PUBKEY_FILE ||
        resolveDefaultSshPubkeyFile() ||
        "";

      const flow = "setup";
      const envAnswers: {
        hcloud: string;
        adminCidr: string;
        sshPubkeyFile: string;
        serverType: string;
        githubToken: string;
      } = {
        hcloud: "",
        adminCidr: String(process.env.ADMIN_CIDR || ""),
        sshPubkeyFile: String(defaultSshPubkey),
        serverType: String(process.env.SERVER_TYPE || "cx43"),
        githubToken: "",
      };

      const envSteps: Array<{
        key: keyof typeof envAnswers;
        prompt: () => Promise<unknown>;
        normalize: (v: unknown) => string;
      }> = [
        {
          key: "hcloud",
          prompt: () =>
            p.password({
              message: "Hetzner API token (HCLOUD_TOKEN)",
              validate: (x) => validateNonEmpty("HCLOUD_TOKEN", x),
            }),
          normalize: (v) => String(v),
        },
        {
          key: "adminCidr",
          prompt: () =>
            p.text({
              message: "Your admin CIDR (ADMIN_CIDR)",
              placeholder: "203.0.113.10/32",
              defaultValue: envAnswers.adminCidr,
              validate: validateAdminCidr,
            }),
          normalize: (v) => String(v),
        },
        {
          key: "sshPubkeyFile",
          prompt: () =>
            p.text({
              message: "Path to your SSH public key file (SSH_PUBKEY_FILE)",
              placeholder: "$HOME/.ssh/id_ed25519.pub",
              defaultValue: envAnswers.sshPubkeyFile,
              validate: (x) => {
                const t = String(x).trim();
                if (!t) return "SSH_PUBKEY_FILE is required";
                if (looksLikeSshKeyContents(t)) return "must be a path, not key contents";
                const expanded = expandPath(t);
                const abs = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
                if (!fs.existsSync(abs)) return `file not found: ${abs}`;
                return undefined;
              },
            }),
          normalize: (v) => String(v),
        },
        {
          key: "serverType",
          prompt: () =>
            p.text({
              message: "Hetzner server type (SERVER_TYPE) (default: cx43; see https://www.hetzner.com/de/cloud/)",
              placeholder: "cx43",
              defaultValue: envAnswers.serverType,
              validate: (x) => {
                const v = String(x).trim();
                if (!v) return "SERVER_TYPE is required";
                if (/^cax/i.test(v)) return "ARM (CAX) not supported (this repo builds x86_64-linux; use CX/CPX/CCX)";
                return undefined;
              },
            }),
          normalize: (v) => String(v),
        },
        {
          key: "githubToken",
          prompt: () =>
            p.password({
              message: "GitHub token (GITHUB_TOKEN) (optional, needed for private flake fetch)",
            }),
          normalize: (v) => String(v).trim(),
        },
      ];

      for (let i = 0; i < envSteps.length;) {
        const step = envSteps[i]!;
        const v = await step.prompt();
        if (p.isCancel(v)) {
          const nav = await cancelOrBack({ flow, canBack: i > 0 });
          if (nav === "exit") return;
          i = Math.max(0, i - 1);
          continue;
        }
        envAnswers[step.key] = step.normalize(v) as never;
        i += 1;
      }

      const sshPubkeyFileRaw = envAnswers.sshPubkeyFile.trim();
      const sshPubkeyFileExpanded = expandPath(sshPubkeyFileRaw);
      const sshPubkeyFile = path.isAbsolute(sshPubkeyFileExpanded)
        ? sshPubkeyFileExpanded
        : path.resolve(cwd, sshPubkeyFileExpanded);
      if (!fs.existsSync(sshPubkeyFile)) {
        throw new Error(`SSH_PUBKEY_FILE not found: ${sshPubkeyFile}`);
      }
      const sshPubkeyText = await fs.promises.readFile(sshPubkeyFile, "utf8");

      const fleetPath = layout.fleetConfigPath;
      if (!fs.existsSync(fleetPath)) throw new Error(`missing fleet config: ${fleetPath}`);
      const fleetText = await fs.promises.readFile(fleetPath, "utf8");
      const bots = parseBotsFromFleetNix(fleetText);
      if (bots.length === 0) throw new Error(`failed to parse bots list from ${fleetPath}`);

      p.log.info(`Bots: ${bots.join(", ")}`);

      const operatorId = (process.env.USER || os.userInfo().username || "operator").trim() || "operator";

      const hostNixPath = getHostNixPath(layout, host);
      let addAdminAuthorizedKey = false;
      let enableBootstrapSsh = false;
      if (fs.existsSync(hostNixPath)) {
        const hostNixText = await fs.promises.readFile(hostNixPath, "utf8");

        const patchedKey = upsertAdminAuthorizedKey({
          hostNix: hostNixText,
          sshPubkey: sshPubkeyText,
        });
        if (patchedKey && patchedKey !== hostNixText) {
          const ok = await p.confirm({
            message: `Add your SSH_PUBKEY_FILE to admin authorizedKeys in ${path.relative(repoRoot, hostNixPath)}?`,
            initialValue: true,
          });
          if (p.isCancel(ok)) {
            const nav = await cancelOrBack({ flow, canBack: false });
            if (nav === "exit") return;
          } else {
            addAdminAuthorizedKey = Boolean(ok);
          }
        }

        const bootstrapMatch = hostNixText.match(/bootstrapSsh\s*=\s*(true|false)\s*;/);
        if (bootstrapMatch?.[1] === "false") {
          const ok = await p.confirm({
            message: "Enable bootstrap SSH on NixOS (bootstrapSsh=true)? (recommended for first install)",
            initialValue: true,
          });
          if (p.isCancel(ok)) {
            const nav = await cancelOrBack({ flow, canBack: false });
            if (nav === "exit") return;
          } else {
            enableBootstrapSsh = Boolean(ok);
          }
        }
      }

      let adminPassword: string | undefined;
      while (true) {
        const first = await p.password({
          message: "Admin sudo password (stored as yescrypt hash in sops) (leave blank to keep existing)",
          validate: (v) => {
            if (!v.trim()) return undefined;
            if (v.length < 12) return "min length 12";
            return undefined;
          },
        });
        if (p.isCancel(first)) {
          const nav = await cancelOrBack({ flow, canBack: false });
          if (nav === "exit") return;
          continue;
        }

        const firstText = String(first).trim();
        if (!firstText) {
          adminPassword = undefined;
          break;
        }

        const second = await p.password({
          message: "Confirm (re-enter)",
          validate: (v) => (v === first ? undefined : "does not match"),
        });
        if (p.isCancel(second)) {
          const nav = await cancelOrBack({ flow, canBack: true });
          if (nav === "exit") return;
          continue;
        }
        adminPassword = firstText;
        break;
      }

      const discordTokens: Record<string, string> = {};
      for (let i = 0; i < bots.length;) {
        const b = bots[i]!;
        const token = await p.password({
          message: `Discord token for ${b} (stored encrypted) (leave blank to keep existing)`,
          validate: () => undefined,
        });
        if (p.isCancel(token)) {
          const nav = await cancelOrBack({ flow, canBack: i > 0 });
          if (nav === "exit") return;
          i = Math.max(0, i - 1);
          continue;
        }
        const trimmed = String(token).trim();
        if (trimmed) discordTokens[b] = trimmed;
        else delete discordTokens[b];
        i += 1;
      }

      const result = await runSetup({
        cwd,
        envFile: args.envFile,
        dryRun: Boolean(args.dryRun),
        answers: {
          host,
          operatorId,
          env: {
            HCLOUD_TOKEN: envAnswers.hcloud,
            ADMIN_CIDR: envAnswers.adminCidr,
            SSH_PUBKEY_FILE: sshPubkeyFileRaw,
            SERVER_TYPE: envAnswers.serverType,
            GITHUB_TOKEN: envAnswers.githubToken || undefined,
          },
          secrets: {
            adminPassword,
            discordTokens,
          },
          patchHostNix: {
            addAdminAuthorizedKey,
            enableBootstrapSsh,
          },
        },
      });

      p.note(result.redactedEnvText, "Final .env (redacted)");

      p.log.info("Running doctor…");
      for (const c of result.doctorChecks) {
        console.log(`${c.status}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
      }
      if (result.doctorChecks.some((c) => c.status === "missing")) {
        throw new Error("doctor failed (missing prerequisites). Fix the items above and retry.");
      }

      p.outro("setup complete");
    } catch (err) {
      throw err;
    }
  },
});
