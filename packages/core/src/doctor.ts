import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import YAML from "yaml";
import { getHostExtraFilesDir, getHostExtraFilesKeyPath, getHostNixPath, getHostSecretsPath, getRepoLayout } from "./repo-layout.js";
import { parseBotsFromFleetNix } from "./lib/fleet.js";
import { tryGetOriginFlake } from "./lib/git.js";
import { checkGithubRepoVisibility, tryParseGithubFlakeUri } from "./lib/github.js";
import { expandPath } from "./lib/path-expand.js";
import { findRepoRoot } from "./lib/repo.js";
import { capture } from "./lib/run.js";
import { looksLikeSshKeyContents, normalizeSshPublicKey } from "./lib/ssh.js";

export type DoctorCheck = {
  status: "ok" | "warn" | "missing";
  label: string;
  detail?: string;
};

function hasYamlKey(text: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`^\\s*${escaped}\\s*:`, "m");
  return rx.test(text);
}

export async function collectDoctorChecks(params: {
  cwd: string;
  envFile?: string;
  host: string;
}): Promise<DoctorCheck[]> {
  const repoRoot = findRepoRoot(params.cwd);
  const layout = getRepoLayout(repoRoot);

  const resolvedEnvFile = params.envFile
    ? path.resolve(params.cwd, params.envFile)
    : fs.existsSync(path.join(repoRoot, ".env"))
      ? path.join(repoRoot, ".env")
      : undefined;

  const envFromFile =
    resolvedEnvFile && fs.existsSync(resolvedEnvFile)
      ? dotenv.parse(fs.readFileSync(resolvedEnvFile, "utf8"))
      : {};

  const getEnv = (k: string): string | undefined => {
    const v = process.env[k] ?? envFromFile[k];
    const trimmed = String(v ?? "").trim();
    return trimmed ? trimmed : undefined;
  };

  const HCLOUD_TOKEN = getEnv("HCLOUD_TOKEN");
  const ADMIN_CIDR = getEnv("ADMIN_CIDR");
  const SSH_PUBKEY_FILE_RAW = getEnv("SSH_PUBKEY_FILE");
  const SSH_PUBKEY_FILE = SSH_PUBKEY_FILE_RAW ? expandPath(SSH_PUBKEY_FILE_RAW) : undefined;
  const NIX_BIN = getEnv("NIX_BIN") || "nix";
  const GITHUB_TOKEN = getEnv("GITHUB_TOKEN");
  const SOPS_AGE_KEY_FILE_RAW = getEnv("SOPS_AGE_KEY_FILE");
  const SOPS_AGE_KEY_FILE = SOPS_AGE_KEY_FILE_RAW ? expandPath(SOPS_AGE_KEY_FILE_RAW) : undefined;

  const host = params.host.trim() || "bots01";

  const terraformDir = layout.terraformDir;
  const extraFilesDir = getHostExtraFilesDir(layout, host);
  const extraFilesKey = getHostExtraFilesKeyPath(layout, host);
  const secretsDir = layout.secretsDir;
  const sopsConfig = layout.sopsConfigPath;
  const secretsFile = getHostSecretsPath(layout, host);
  const hostNixFile = getHostNixPath(layout, host);

  const checks: DoctorCheck[] = [
    {
      status: fs.existsSync(path.join(repoRoot, "flake.nix")) ? "ok" : "missing",
      label: "repo root",
      detail: repoRoot,
    },
    {
      status: resolvedEnvFile ? (fs.existsSync(resolvedEnvFile) ? "ok" : "missing") : "warn",
      label: "env file",
      detail: resolvedEnvFile ?? "(none)",
    },
    {
      status: fs.existsSync(terraformDir) ? "ok" : "missing",
      label: "terraform dir",
      detail: terraformDir,
    },
    {
      status: fs.existsSync(extraFilesDir) ? "ok" : "missing",
      label: "nixos-anywhere extra-files dir",
      detail: extraFilesDir,
    },
    {
      status: fs.existsSync(extraFilesKey) ? "ok" : "missing",
      label: "sops-nix age key (extra-files)",
      detail: extraFilesKey,
    },
    {
      status: fs.existsSync(sopsConfig) ? "ok" : "missing",
      label: "sops config",
      detail: sopsConfig,
    },
    {
      status: fs.existsSync(secretsFile) ? "ok" : "missing",
      label: "sops secrets file",
      detail: secretsFile,
    },
    {
      status: SSH_PUBKEY_FILE ? (fs.existsSync(SSH_PUBKEY_FILE) ? "ok" : "missing") : "missing",
      label: "SSH_PUBKEY_FILE",
      detail: SSH_PUBKEY_FILE || "(missing)",
    },
  ];

  try {
    const v = await capture(NIX_BIN, ["--version"], { cwd: repoRoot });
    checks.push({ status: "ok", label: "nix", detail: v });
  } catch {
    checks.push({
      status: "missing",
      label: "nix",
      detail: `(${NIX_BIN} not found; install Nix first)`,
    });
  }

  for (const k of ["HCLOUD_TOKEN", "ADMIN_CIDR", "SSH_PUBKEY_FILE"] as const) {
    const v = k === "SSH_PUBKEY_FILE" ? SSH_PUBKEY_FILE_RAW : getEnv(k);
    checks.push({
      status: v ? "ok" : "missing",
      label: k,
      detail: k === "HCLOUD_TOKEN" && v ? "(set)" : undefined,
    });
  }

  if (SSH_PUBKEY_FILE_RAW && looksLikeSshKeyContents(SSH_PUBKEY_FILE_RAW)) {
    checks.push({
      status: "missing",
      label: "SSH_PUBKEY_FILE",
      detail: "(must be a path, not key contents)",
    });
  }

  if (SOPS_AGE_KEY_FILE) {
    checks.push({
      status: fs.existsSync(SOPS_AGE_KEY_FILE) ? "ok" : "missing",
      label: "SOPS_AGE_KEY_FILE",
      detail: SOPS_AGE_KEY_FILE,
    });
  } else {
    checks.push({
      status: "warn",
      label: "SOPS_AGE_KEY_FILE",
      detail: "(not set; sops edit/decrypt may fail)",
    });
  }

  if (fs.existsSync(sopsConfig)) {
    const sopsText = fs.readFileSync(sopsConfig, "utf8");
    try {
      const parsed = (YAML.parse(sopsText) as { creation_rules?: unknown }) || {};
      const rules = Array.isArray((parsed as { creation_rules?: unknown }).creation_rules)
        ? ((parsed as { creation_rules: unknown[] }).creation_rules as Array<{ path_regex?: unknown }>)
        : [];
      const hasRule = rules.some((r) => String(r?.path_regex || "") === `^${host}\\.yaml$`);
      checks.push({
        status: hasRule ? "ok" : "missing",
        label: "sops creation rule",
        detail: hasRule ? `(${host}.yaml)` : `(missing rule for ${host}.yaml)`,
      });
    } catch {
      checks.push({ status: "warn", label: "sops config parse", detail: "(invalid YAML)" });
    }
  }

  const fleetPath = layout.fleetConfigPath;
  if (fs.existsSync(fleetPath)) {
    const fleetText = fs.readFileSync(fleetPath, "utf8");
    const bots = parseBotsFromFleetNix(fleetText);
    checks.push({
      status: bots.length > 0 ? "ok" : "warn",
      label: "fleet bots list",
      detail: bots.length > 0 ? bots.join(", ") : "(could not parse bots = [ ... ])",
    });

    if (fs.existsSync(secretsFile)) {
      const secretsText = fs.readFileSync(secretsFile, "utf8");
      const requiredKeys = ["wg_private_key", "admin_password_hash", ...bots.map((b) => `discord_token_${b}`)];

      for (const k of requiredKeys) {
        checks.push({
          status: hasYamlKey(secretsText, k) ? "ok" : "missing",
          label: `infra/secrets/${host}.yaml: ${k}`,
        });
      }
    }
  } else {
    checks.push({ status: "missing", label: "fleet config", detail: fleetPath });
  }

  if (fs.existsSync(hostNixFile)) {
    const hostText = fs.readFileSync(hostNixFile, "utf8");
    const sshKey =
      SSH_PUBKEY_FILE && fs.existsSync(SSH_PUBKEY_FILE)
        ? normalizeSshPublicKey(fs.readFileSync(SSH_PUBKEY_FILE, "utf8"))
        : null;
    if (sshKey) {
      checks.push({
        status: hostText.includes(sshKey) ? "ok" : "warn",
        label: "admin authorizedKeys includes SSH_PUBKEY_FILE",
        detail: hostText.includes(sshKey) ? hostNixFile : `(add your key to ${hostNixFile})`,
      });
    }

    const bootstrapMatch = hostText.match(/bootstrapSsh\s*=\s*(true|false)\s*;/);
    if (bootstrapMatch?.[1] === "false") {
      checks.push({
        status: "warn",
        label: "bootstrapSsh",
        detail: "(false; public SSH on port 22 will be closed after install)",
      });
    } else if (bootstrapMatch?.[1] === "true") {
      checks.push({
        status: "ok",
        label: "bootstrapSsh",
        detail: "(true)",
      });
    }
  } else {
    checks.push({
      status: fs.existsSync(hostNixFile) ? "ok" : "missing",
      label: "host nix config",
      detail: hostNixFile,
    });
  }

  const originFlake = await tryGetOriginFlake(repoRoot);
  const flakeBase = originFlake || repoRoot;
  const githubRepo = tryParseGithubFlakeUri(flakeBase);

  if (!githubRepo) {
    checks.push({
      status: "ok",
      label: "GITHUB_TOKEN",
      detail: "(not needed; origin flake is not github:...)",
    });
  } else if (GITHUB_TOKEN) {
    const check = await checkGithubRepoVisibility({
      owner: githubRepo.owner,
      repo: githubRepo.repo,
      token: GITHUB_TOKEN,
    });

    if (check.ok && check.status === "public") {
      checks.push({
        status: "ok",
        label: "GITHUB_TOKEN",
        detail: `(set; has access to ${githubRepo.owner}/${githubRepo.repo})`,
      });
    } else if (check.ok && check.status === "unauthorized") {
      checks.push({
        status: "missing",
        label: "GITHUB_TOKEN",
        detail: "(invalid/expired; GitHub API returned 401)",
      });
    } else if (check.ok && check.status === "private-or-missing") {
      checks.push({
        status: "missing",
        label: "GITHUB_TOKEN",
        detail: `(set but no access; GitHub API returned 404 for ${githubRepo.owner}/${githubRepo.repo})`,
      });
    } else if (check.ok && check.status === "rate-limited") {
      checks.push({
        status: "warn",
        label: "GITHUB_TOKEN",
        detail: "(set; GitHub API rate-limited during verification)",
      });
    } else {
      checks.push({
        status: "warn",
        label: "GITHUB_TOKEN",
        detail: "(set; could not verify against GitHub API)",
      });
    }
  } else {
    const check = await checkGithubRepoVisibility({
      owner: githubRepo.owner,
      repo: githubRepo.repo,
    });

    if (check.ok && check.status === "public") {
      checks.push({
        status: "ok",
        label: "GITHUB_TOKEN",
        detail: `(optional; ${githubRepo.owner}/${githubRepo.repo} is public)`,
      });
    } else if (check.ok && check.status === "private-or-missing") {
      checks.push({
        status: "missing",
        label: "GITHUB_TOKEN",
        detail: `(required; ${githubRepo.owner}/${githubRepo.repo} is private)`,
      });
    } else if (check.ok && check.status === "rate-limited") {
      checks.push({
        status: "warn",
        label: "GITHUB_TOKEN",
        detail: "(unknown; GitHub API rate-limited; if bootstrap fails with 404, set token)",
      });
    } else {
      checks.push({
        status: "warn",
        label: "GITHUB_TOKEN",
        detail: "(unknown; could not verify repo visibility; if bootstrap fails with 404, set token)",
      });
    }
  }

  return checks;
}
