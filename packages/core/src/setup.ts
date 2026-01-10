import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import { collectDoctorChecks, type DoctorCheck } from "./doctor.js";
import { getHostExtraFilesKeyPath, getHostNixPath, getHostSecretsPath, getRepoLayout } from "./repo-layout.js";
import { ageKeygen } from "./lib/age-keygen.js";
import { parseAgeKeyFile } from "./lib/age.js";
import { upsertDotenv, redactDotenv } from "./lib/dotenv-file.js";
import { parseBotsFromFleetNix } from "./lib/fleet.js";
import { backupFile, ensureDir, writeFileAtomic } from "./lib/fs-safe.js";
import { mkpasswdYescryptHash } from "./lib/mkpasswd.js";
import { setBootstrapSsh, upsertAdminAuthorizedKey } from "./lib/nix-host.js";
import { expandPath } from "./lib/path-expand.js";
import { findRepoRoot } from "./lib/repo.js";
import { upsertSopsCreationRule } from "./lib/sops-config.js";
import { sopsDecryptYamlFile, sopsEncryptYamlToFile } from "./lib/sops.js";
import { looksLikeSshKeyContents } from "./lib/ssh.js";
import { wgGenKey } from "./lib/wireguard.js";

export type SetupAnswers = {
  host: string;
  operatorId: string;
  env: {
    HCLOUD_TOKEN: string;
    ADMIN_CIDR: string;
    SSH_PUBKEY_FILE: string;
    SERVER_TYPE: string;
    GITHUB_TOKEN?: string;
  };
  secrets: {
    adminPassword?: string;
    discordTokens: Record<string, string>;
  };
  patchHostNix: {
    addAdminAuthorizedKey: boolean;
    enableBootstrapSsh: boolean;
  };
};

export type SetupParams = {
  cwd: string;
  envFile?: string;
  dryRun: boolean;
  answers: SetupAnswers;
};

export type SetupResult = {
  repoRoot: string;
  envFile: string;
  redactedEnvText: string;
  bots: string[];
  doctorChecks: DoctorCheck[];
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function validateAdminCidr(value: string): void {
  const v = value.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(v)) {
    throw new Error("ADMIN_CIDR must be an IPv4 CIDR (example: 203.0.113.10/32)");
  }
  const [ip, bitsRaw] = v.split("/");
  const bits = Number(bitsRaw);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) throw new Error("ADMIN_CIDR has invalid CIDR bits (0-32)");
  const octets = ip!.split(".").map((x) => Number(x));
  if (octets.length !== 4 || octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    throw new Error("ADMIN_CIDR has invalid IPv4 address");
  }
}

function normalizeOperatorId(value: string): string {
  const v = value.trim() || "operator";
  return v.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function normalizeHostId(value: string): string {
  const v = value.trim() || "bots01";
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    throw new Error(`invalid host: ${value} (expected letters/digits/._-)`);
  }
  return v;
}

export async function runSetup(params: SetupParams): Promise<SetupResult> {
  const repoRoot = findRepoRoot(params.cwd);
  const layout = getRepoLayout(repoRoot);

  const host = normalizeHostId(params.answers.host);
  const operatorId = normalizeOperatorId(params.answers.operatorId || os.userInfo().username || "operator");
  const dryRun = Boolean(params.dryRun);

  const envFile = params.envFile ? path.resolve(params.cwd, params.envFile) : path.join(repoRoot, ".env");
  const envText = (await fileExists(envFile)) ? await fs.promises.readFile(envFile, "utf8") : "";
  const envParsed = dotenv.parse(envText);

  validateAdminCidr(params.answers.env.ADMIN_CIDR);

  const hcloudToken = params.answers.env.HCLOUD_TOKEN.trim();
  if (!hcloudToken) throw new Error("HCLOUD_TOKEN is required");
  const serverType = params.answers.env.SERVER_TYPE.trim();
  if (!serverType) throw new Error("SERVER_TYPE is required");

  const sshPubkeyFileRaw = params.answers.env.SSH_PUBKEY_FILE.trim();
  if (!sshPubkeyFileRaw) throw new Error("SSH_PUBKEY_FILE is required");
  if (looksLikeSshKeyContents(sshPubkeyFileRaw)) throw new Error("SSH_PUBKEY_FILE must be a path, not key contents");
  const sshPubkeyFileExpanded = expandPath(sshPubkeyFileRaw);
  const sshPubkeyFile = path.isAbsolute(sshPubkeyFileExpanded)
    ? sshPubkeyFileExpanded
    : path.resolve(params.cwd, sshPubkeyFileExpanded);
  if (!fs.existsSync(sshPubkeyFile)) throw new Error(`SSH_PUBKEY_FILE not found: ${sshPubkeyFile}`);
  const sshPubkeyText = await fs.promises.readFile(sshPubkeyFile, "utf8");

  if (!fs.existsSync(layout.fleetConfigPath)) throw new Error(`missing fleet config: ${layout.fleetConfigPath}`);
  const bots = parseBotsFromFleetNix(await fs.promises.readFile(layout.fleetConfigPath, "utf8"));
  if (bots.length === 0) throw new Error(`failed to parse bots list from ${layout.fleetConfigPath}`);

  const operatorKeyPath = path.join(layout.secretsOperatorsDir, `${operatorId}.agekey`);
  const operatorPubPath = path.join(layout.secretsOperatorsDir, `${operatorId}.age.pub`);
  const hostKeyPath = path.join(layout.secretsHostsDir, `${host}.agekey`);
  const hostPubPath = path.join(layout.secretsHostsDir, `${host}.age.pub`);
  const extraFilesKeyPath = getHostExtraFilesKeyPath(layout, host);
  const secretsFile = getHostSecretsPath(layout, host);
  const hostNixPath = getHostNixPath(layout, host);

  const nixBin = envParsed.NIX_BIN || process.env.NIX_BIN || "nix";
  const nix = { nixBin, cwd: repoRoot, dryRun } as const;

  const envUpdates: Record<string, string> = {
    HCLOUD_TOKEN: hcloudToken,
    ADMIN_CIDR: params.answers.env.ADMIN_CIDR,
    SSH_PUBKEY_FILE: sshPubkeyFile,
    SERVER_TYPE: serverType,
    SOPS_AGE_KEY_FILE: operatorKeyPath,
  };
  if (params.answers.env.GITHUB_TOKEN) envUpdates.GITHUB_TOKEN = params.answers.env.GITHUB_TOKEN;

  const nextEnvText = upsertDotenv(envText, envUpdates);
  if (!dryRun) {
    if ((await fileExists(envFile)) && nextEnvText !== envText) await backupFile(envFile);
    await writeFileAtomic(envFile, nextEnvText, { mode: 0o600 });
  }

  if (params.answers.patchHostNix.addAdminAuthorizedKey || params.answers.patchHostNix.enableBootstrapSsh) {
    if (await fileExists(hostNixPath)) {
      let nextHostNix = await fs.promises.readFile(hostNixPath, "utf8");
      let changed = false;

      if (params.answers.patchHostNix.addAdminAuthorizedKey) {
        const patchedKey = upsertAdminAuthorizedKey({
          hostNix: nextHostNix,
          sshPubkey: sshPubkeyText,
        });
        if (patchedKey && patchedKey !== nextHostNix) {
          nextHostNix = patchedKey;
          changed = true;
        }
      }

      if (params.answers.patchHostNix.enableBootstrapSsh) {
        const bootstrapMatch = nextHostNix.match(/bootstrapSsh\s*=\s*(true|false)\s*;/);
        if (bootstrapMatch?.[1] === "false") {
          nextHostNix = setBootstrapSsh({ hostNix: nextHostNix, enabled: true });
          changed = true;
        }
      }

      if (changed && !dryRun) {
        await backupFile(hostNixPath);
        await writeFileAtomic(hostNixPath, nextHostNix);
      }
    }
  }

  const ensureAgePair = async (keyPath: string, pubPath: string, label: string) => {
    if ((await fileExists(keyPath)) && (await fileExists(pubPath))) {
      const keyText = await fs.promises.readFile(keyPath, "utf8");
      const parsed = parseAgeKeyFile(keyText);
      const publicKey = (await fs.promises.readFile(pubPath, "utf8")).trim();
      if (!parsed.secretKey) throw new Error(`invalid age key (missing secret): ${keyPath}`);
      if (!publicKey) throw new Error(`invalid age public key: ${pubPath}`);
      return { secretKey: parsed.secretKey, publicKey };
    }
    const pair = await ageKeygen(nix);
    if (!dryRun) {
      await ensureDir(path.dirname(keyPath));
      await writeFileAtomic(keyPath, pair.fileText, { mode: 0o600 });
      await writeFileAtomic(pubPath, `${pair.publicKey}\n`, { mode: 0o644 });
    }
    return { secretKey: pair.secretKey, publicKey: pair.publicKey };
  };

  const operatorKeys = await ensureAgePair(operatorKeyPath, operatorPubPath, "Generating operator age key");
  const hostKeys = await ensureAgePair(hostKeyPath, hostPubPath, "Generating host age key");

  const sopsExisting = (await fileExists(layout.sopsConfigPath)) ? await fs.promises.readFile(layout.sopsConfigPath, "utf8") : undefined;
  const sopsYaml = upsertSopsCreationRule({
    existingYaml: sopsExisting,
    pathRegex: `^${host}\\.yaml$`,
    ageRecipients: [hostKeys.publicKey, operatorKeys.publicKey],
  });
  if (!dryRun) {
    if (await fileExists(layout.sopsConfigPath)) await backupFile(layout.sopsConfigPath);
    await writeFileAtomic(layout.sopsConfigPath, sopsYaml, { mode: 0o644 });
  }

  if (!dryRun) {
    await ensureDir(path.dirname(extraFilesKeyPath));
    await writeFileAtomic(extraFilesKeyPath, `${hostKeys.secretKey}\n`, { mode: 0o600 });
  }

  let existingSecrets: Record<string, unknown> = {};
  if (await fileExists(secretsFile)) {
    try {
      const dec = await sopsDecryptYamlFile({
        filePath: secretsFile,
        filenameOverride: `${host}.yaml`,
        sopsConfigPath: layout.sopsConfigPath,
        ageKeyFile: operatorKeyPath,
        nix,
      });
      existingSecrets = (YAML.parse(dec) as Record<string, unknown>) || {};
    } catch {
      existingSecrets = {};
    }
  }

  const existingStringMap = Object.fromEntries(
    Object.entries(existingSecrets)
      .filter(([, v]) => typeof v === "string")
      .map(([k, v]) => [k, String(v)]),
  );

  const nextSecrets: Record<string, string> = { ...existingStringMap };

  if (!nextSecrets.wg_private_key) {
    nextSecrets.wg_private_key = dryRun ? "<wg_private_key>" : await wgGenKey(nix);
  }

  if (!nextSecrets.admin_password_hash) {
    if (dryRun) {
      nextSecrets.admin_password_hash = "<admin_password_hash>";
    } else {
      const pw = params.answers.secrets.adminPassword?.trim();
      if (!pw) throw new Error("missing admin password (admin_password_hash not present)");
      nextSecrets.admin_password_hash = await mkpasswdYescryptHash(pw, nix);
    }
  }

  for (const b of bots) {
    const k = `discord_token_${b}`;
    if (nextSecrets[k]) continue;
    const token = params.answers.secrets.discordTokens[b]?.trim();
    if (!token) throw new Error(`missing Discord token for ${b} (${k})`);
    nextSecrets[k] = token;
  }

  const secretsYamlPlain = YAML.stringify(nextSecrets);
  if (!dryRun) {
    if (await fileExists(secretsFile)) await backupFile(secretsFile);
    await sopsEncryptYamlToFile({
      plaintextYaml: secretsYamlPlain,
      outPath: secretsFile,
      filenameOverride: `${host}.yaml`,
      sopsConfigPath: layout.sopsConfigPath,
      nix,
    });
  }

  const redactedEnvText = redactDotenv(nextEnvText, ["HCLOUD_TOKEN", "GITHUB_TOKEN"]);
  const doctorChecks = await collectDoctorChecks({ cwd: repoRoot, envFile, host });

  return {
    repoRoot,
    envFile,
    redactedEnvText,
    bots,
    doctorChecks,
  };
}
