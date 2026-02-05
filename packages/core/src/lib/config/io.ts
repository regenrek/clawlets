import fs from "node:fs";
import { writeFileAtomic } from "../fs-safe.js";
import type { RepoLayout } from "../../repo-layout.js";
import { getRepoLayout } from "../../repo-layout.js";
import { assertNoLegacyEnvSecrets, assertNoLegacyHostKeys } from "../clawlets-config-legacy.js";
import { ClawletsConfigSchema, type ClawletsConfig } from "./schema.js";

export function loadClawletsConfigRaw(params: { repoRoot: string; runtimeDir?: string }): {
  layout: RepoLayout;
  configPath: string;
  config: unknown;
} {
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  const configPath = layout.clawletsConfigPath;
  if (!fs.existsSync(configPath)) throw new Error(`missing clawlets config: ${configPath}`);
  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON: ${configPath}`);
  }
  assertNoLegacyHostKeys(parsed);
  assertNoLegacyEnvSecrets(parsed);
  return { layout, configPath, config: parsed };
}

export function loadClawletsConfig(params: { repoRoot: string; runtimeDir?: string }): {
  layout: RepoLayout;
  configPath: string;
  config: ClawletsConfig;
} {
  const { layout, configPath, config: raw } = loadClawletsConfigRaw(params);
  const config = ClawletsConfigSchema.parse(raw);
  return { layout, configPath, config };
}

export async function writeClawletsConfig(params: { configPath: string; config: ClawletsConfig }): Promise<void> {
  await writeFileAtomic(params.configPath, `${JSON.stringify(params.config, null, 2)}\n`);
}
