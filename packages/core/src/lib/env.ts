import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { expandPath } from "./path-expand.js";
import { findRepoRoot } from "./repo.js";

export type FleetEnv = {
  HCLOUD_TOKEN: string;
  ADMIN_CIDR: string;
  SSH_PUBKEY_FILE: string;
  SERVER_TYPE?: string;
  NIX_BIN?: string;
  GITHUB_TOKEN?: string;
  SOPS_AGE_KEY_FILE?: string;
};

export type LoadEnvResult = {
  repoRoot: string;
  envFile?: string;
  env: FleetEnv;
};

export type LoadEnvFileResult = {
  repoRoot: string;
  envFile?: string;
  envFromFile: Record<string, string>;
};

export function loadEnvFile(params: { cwd: string; envFile?: string }): LoadEnvFileResult {
  const repoRoot = findRepoRoot(params.cwd);
  const defaultEnvFile = path.join(repoRoot, ".env");
  const envFile = params.envFile
    ? path.resolve(params.cwd, params.envFile)
    : fs.existsSync(defaultEnvFile)
      ? defaultEnvFile
      : undefined;

  const envFromFile =
    envFile && fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile, "utf8")) : {};

  return { repoRoot, envFile, envFromFile };
}

export function loadFleetEnv(params: {
  cwd: string;
  envFile?: string;
}): LoadEnvResult {
  const loaded = loadEnvFile(params);
  const { repoRoot, envFile, envFromFile } = loaded;

  const getEnv = (k: string): string | undefined => {
    const v = process.env[k] ?? envFromFile[k];
    const trimmed = String(v ?? "").trim();
    return trimmed ? trimmed : undefined;
  };

  const required = ["HCLOUD_TOKEN", "ADMIN_CIDR", "SSH_PUBKEY_FILE"] as const;
  const missing = required.filter((k) => !getEnv(k));
  if (missing.length > 0) {
    const src = envFile ? `env file: ${envFile}` : "no env file found";
    throw new Error(
      `missing required env vars (${missing.join(", ")}); ${src}`,
    );
  }

  const SSH_PUBKEY_FILE_RAW = String(getEnv("SSH_PUBKEY_FILE")).trim();
  const SSH_PUBKEY_FILE = expandPath(SSH_PUBKEY_FILE_RAW);
  if (/^ssh-[a-z0-9-]+\s+/.test(SSH_PUBKEY_FILE_RAW)) {
    throw new Error(
      `SSH_PUBKEY_FILE must be a path to a .pub file (not the key contents). Example: SSH_PUBKEY_FILE=$HOME/.ssh/id_ed25519.pub`,
    );
  }
  if (!fs.existsSync(SSH_PUBKEY_FILE)) {
    throw new Error(`SSH_PUBKEY_FILE not found: ${SSH_PUBKEY_FILE}`);
  }

  const SOPS_AGE_KEY_FILE_RAW = getEnv("SOPS_AGE_KEY_FILE")?.trim();
  const SOPS_AGE_KEY_FILE = SOPS_AGE_KEY_FILE_RAW
    ? expandPath(SOPS_AGE_KEY_FILE_RAW)
    : undefined;

  return {
    repoRoot,
    envFile,
    env: {
      HCLOUD_TOKEN: String(getEnv("HCLOUD_TOKEN")).trim(),
      ADMIN_CIDR: String(getEnv("ADMIN_CIDR")).trim(),
      SSH_PUBKEY_FILE,
      SERVER_TYPE: getEnv("SERVER_TYPE")?.trim() || undefined,
      NIX_BIN: getEnv("NIX_BIN")?.trim() || undefined,
      GITHUB_TOKEN: getEnv("GITHUB_TOKEN")?.trim() || undefined,
      SOPS_AGE_KEY_FILE,
    },
  };
}
