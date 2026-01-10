import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { ageKeygen } from "@clawdbot/clawdlets-core/lib/age-keygen";
import { parseAgeKeyFile } from "@clawdbot/clawdlets-core/lib/age";
import { upsertDotenv } from "@clawdbot/clawdlets-core/lib/dotenv-file";
import { run } from "@clawdbot/clawdlets-core/lib/run";
import { ensureDir, writeFileAtomic } from "@clawdbot/clawdlets-core/lib/fs-safe";
import { mkpasswdYescryptHash } from "@clawdbot/clawdlets-core/lib/mkpasswd";
import { upsertSopsCreationRule } from "@clawdbot/clawdlets-core/lib/sops-config";
import { sopsDecryptYamlFile, sopsEncryptYamlToFile } from "@clawdbot/clawdlets-core/lib/sops";
import { shellQuote, sshRun } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import { wgGenKey } from "@clawdbot/clawdlets-core/lib/wireguard";
import { loadStack } from "@clawdbot/clawdlets-core/stack";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../lib/wizard.js";

function needsSudo(targetHost: string): boolean {
  return !/^root@/i.test(targetHost.trim());
}

function requireTargetHost(targetHost: string, hostName: string): string {
  const v = targetHost.trim();
  if (v) return v;
  throw new Error(
    [
      `missing target host for ${hostName}`,
      "set it in .clawdlets/stack.json (hosts.<host>.targetHost) or pass --target-host",
      "recommended: use an SSH config alias (e.g. botsmj)",
    ].join("; "),
  );
}

const secretsInit = defineCommand({
  meta: {
    name: "init",
    description: "Create or update an encrypted secrets file (sops + age).",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: bots01).", default: "bots01" },
    operator: {
      type: "string",
      description: "Operator id for local age key name (default: $USER).",
    },
    yes: { type: "boolean", description: "Overwrite without prompt.", default: false },
    dryRun: { type: "boolean", description: "Print actions without writing.", default: false },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "bots01").trim() || "bots01";
    const host = stack.hosts[hostName];
    if (!host) throw new Error(`unknown host: ${hostName}`);

    if (!process.stdout.isTTY) throw new Error("secrets init requires a TTY (interactive)");

    const operatorId =
      String(args.operator || process.env.USER || "operator")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "_") || "operator";

    const secretsDir = path.join(layout.stackDir, "secrets");
    const sopsConfigPath = path.join(secretsDir, ".sops.yaml");
    const operatorKeyPath = path.join(secretsDir, "operators", `${operatorId}.agekey`);
    const operatorPubPath = path.join(secretsDir, "operators", `${operatorId}.age.pub`);
    const hostKeyPath = path.join(secretsDir, "hosts", `${hostName}.agekey`);
    const hostPubPath = path.join(secretsDir, "hosts", `${hostName}.age.pub`);
    const extraFilesKeyPath = path.join(layout.stackDir, "extra-files", hostName, "var/lib/sops-nix/key.txt");
    const extraFilesSecretsPath = path.join(
      layout.stackDir,
      "extra-files",
      hostName,
      "var/lib/clawdlets/secrets/hosts",
      `${hostName}.yaml`,
    );

    const localSecretsFile = path.join(layout.stackDir, host.secrets.localFile);

    if (fs.existsSync(localSecretsFile) && !args.yes) {
      const ok = await p.confirm({ message: `Update existing secrets file? (${localSecretsFile})`, initialValue: true });
      if (p.isCancel(ok)) {
        const nav = await navOnCancel({ flow: "secrets init", canBack: false });
        if (nav === NAV_EXIT) cancelFlow();
        return;
      }
      if (!ok) return;
    }

    const nix = { nixBin: "nix", cwd: layout.repoRoot, dryRun: Boolean(args.dryRun) } as const;

    const ensureAgePair = async (keyPath: string, pubPath: string) => {
      if (fs.existsSync(keyPath) && fs.existsSync(pubPath)) {
        const keyText = fs.readFileSync(keyPath, "utf8");
        const parsed = parseAgeKeyFile(keyText);
        const publicKey = fs.readFileSync(pubPath, "utf8").trim();
        if (!parsed.secretKey) throw new Error(`invalid age key: ${keyPath}`);
        if (!publicKey) throw new Error(`invalid age public key: ${pubPath}`);
        return { secretKey: parsed.secretKey, publicKey };
      }
      const pair = await ageKeygen(nix);
      if (!args.dryRun) {
        await ensureDir(path.dirname(keyPath));
        await writeFileAtomic(keyPath, pair.fileText, { mode: 0o600 });
        await writeFileAtomic(pubPath, `${pair.publicKey}\n`, { mode: 0o644 });
      }
      return { secretKey: pair.secretKey, publicKey: pair.publicKey };
    };

    const operatorKeys = await ensureAgePair(operatorKeyPath, operatorPubPath);
    const hostKeys = await ensureAgePair(hostKeyPath, hostPubPath);

    const existingSops = fs.existsSync(sopsConfigPath) ? fs.readFileSync(sopsConfigPath, "utf8") : undefined;
    const nextSops = upsertSopsCreationRule({
      existingYaml: existingSops,
      pathRegex: `^${hostName}\\.yaml$`,
      ageRecipients: [hostKeys.publicKey, operatorKeys.publicKey],
    });
    if (!args.dryRun) {
      await ensureDir(path.dirname(sopsConfigPath));
      await writeFileAtomic(sopsConfigPath, nextSops, { mode: 0o644 });
    }

    if (!args.dryRun) {
      await ensureDir(path.dirname(extraFilesKeyPath));
      await writeFileAtomic(extraFilesKeyPath, `${hostKeys.secretKey}\n`, { mode: 0o600 });
    }

    const flow = "secrets init";
    const values: { adminPassword: string; zAiApiKey: string } = { adminPassword: "", zAiApiKey: "" };
    const steps: Array<{
      key: keyof typeof values;
      prompt: () => Promise<unknown>;
      normalize: (v: unknown) => string;
    }> = [
      {
        key: "adminPassword",
        prompt: () =>
          p.password({
            message: "Admin password (used to generate admin_password_hash; leave blank to keep existing/placeholder)",
          }),
        normalize: (v) => String(v),
      },
      {
        key: "zAiApiKey",
        prompt: () => p.password({ message: "ZAI API key (z_ai_api_key) (optional)" }),
        normalize: (v) => String(v),
      },
    ];

    for (let i = 0; i < steps.length;) {
      const step = steps[i]!;
      const v = await step.prompt();
      if (p.isCancel(v)) {
        const nav = await navOnCancel({ flow, canBack: i > 0 });
        if (nav === NAV_EXIT) {
          cancelFlow();
          return;
        }
        i = Math.max(0, i - 1);
        continue;
      }
      values[step.key] = step.normalize(v);
      i += 1;
    }

    const adminPassword = values.adminPassword;
    const zAiApiKey = values.zAiApiKey;

    let existingDecrypted: string | null = null;
    if (fs.existsSync(localSecretsFile)) {
      try {
        existingDecrypted = await sopsDecryptYamlFile({
          filePath: localSecretsFile,
          filenameOverride: `${hostName}.yaml`,
          sopsConfigPath,
          ageKeyFile: operatorKeyPath,
          nix,
        });
      } catch {
        existingDecrypted = null;
      }
    }

    const nextPlaintextLines: string[] = [];
    if (existingDecrypted) {
      nextPlaintextLines.push(existingDecrypted.trimEnd());
    } else {
      nextPlaintextLines.push(`wg_private_key: "${args.dryRun ? "<wg_private_key>" : await wgGenKey(nix)}"`);
      nextPlaintextLines.push(`admin_password_hash: "${adminPassword ? (args.dryRun ? "<admin_password_hash>" : await mkpasswdYescryptHash(String(adminPassword), nix)) : "<FILL_ME>"}"`);
      nextPlaintextLines.push(`z_ai_api_key: "${zAiApiKey ? String(zAiApiKey) : "<OPTIONAL>"}"`);
      nextPlaintextLines.push(`discord_token_maren: "<FILL_ME>"`);
      nextPlaintextLines.push(`discord_token_sonja: "<FILL_ME>"`);
      nextPlaintextLines.push(`discord_token_gunnar: "<FILL_ME>"`);
      nextPlaintextLines.push(`discord_token_melinda: "<FILL_ME>"`);
    }
    const plaintextYaml = `${nextPlaintextLines.join("\n")}\n`;

    if (!args.dryRun) {
      await ensureDir(path.dirname(localSecretsFile));
      await sopsEncryptYamlToFile({
        plaintextYaml,
        outPath: localSecretsFile,
        filenameOverride: `${hostName}.yaml`,
        sopsConfigPath,
        nix,
      });

      const encrypted = fs.readFileSync(localSecretsFile, "utf8");
      await ensureDir(path.dirname(extraFilesSecretsPath));
      await writeFileAtomic(extraFilesSecretsPath, encrypted, { mode: 0o400 });
    }

    const stackEnvPath = path.join(layout.stackDir, stack.envFile || ".env");
    const envText = fs.existsSync(stackEnvPath) ? fs.readFileSync(stackEnvPath, "utf8") : "";
    const nextEnvText = upsertDotenv(envText, { SOPS_AGE_KEY_FILE: operatorKeyPath });
    if (!args.dryRun) {
      await writeFileAtomic(stackEnvPath, nextEnvText, { mode: 0o600 });
    }

    console.log(`ok: secrets ready at ${localSecretsFile}`);
    console.log(`ok: sops config at ${sopsConfigPath}`);
    console.log(`ok: extra-files key at ${extraFilesKeyPath}`);
    console.log(`ok: extra-files secrets at ${extraFilesSecretsPath}`);
  },
});

const secretsSync = defineCommand({
  meta: {
    name: "sync",
    description: "Copy local secrets file to the server filesystem path.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: bots01).", default: "bots01" },
    targetHost: { type: "string", description: "SSH target override (default: from stack)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "bots01").trim() || "bots01";
    const host = stack.hosts[hostName];
    if (!host) throw new Error(`unknown host: ${hostName}`);

    const targetHost = requireTargetHost(String(args.targetHost || host.targetHost || ""), hostName);

    const localFile = path.join(layout.stackDir, host.secrets.localFile);
    if (!fs.existsSync(localFile)) throw new Error(`missing local secrets file: ${localFile}`);

    const remoteFile = host.secrets.remoteFile;
    const remoteDir = path.posix.dirname(remoteFile);
    const tmp = `/tmp/clawdlets-secrets.${hostName}.${process.pid}.yaml`;

    await run("scp", [localFile, `${targetHost}:${tmp}`], { redact: [] });

    const sudo = needsSudo(targetHost);
    const installCmd = [
      ...(sudo ? ["sudo"] : []),
      "sh",
      "-lc",
      [
        `mkdir -p ${shellQuote(remoteDir)}`,
        `install -m 0400 -o root -g root ${shellQuote(tmp)} ${shellQuote(remoteFile)}`,
        `rm -f ${shellQuote(tmp)}`,
      ].join(" && "),
    ].join(" ");
    await sshRun(targetHost, installCmd, { tty: sudo && args.sshTty });

    console.log(`ok: synced secrets to ${remoteFile}`);
  },
});

const secretsView = defineCommand({
  meta: {
    name: "path",
    description: "Print local + remote secrets paths for a host.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: bots01).", default: "bots01" },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "bots01").trim() || "bots01";
    const host = stack.hosts[hostName];
    if (!host) throw new Error(`unknown host: ${hostName}`);
    console.log(`local: ${path.join(layout.stackDir, host.secrets.localFile)}`);
    console.log(`remote: ${host.secrets.remoteFile}`);
  },
});

export const secrets = defineCommand({
  meta: {
    name: "secrets",
    description: "Secrets workflow (local template + sync).",
  },
  subCommands: {
    init: secretsInit,
    sync: secretsSync,
    path: secretsView,
  },
});
