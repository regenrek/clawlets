import { findRepoRoot } from "./repo.js";
import { loadClawdletsConfig, type ClawdletsConfig, type ClawdletsHostConfig } from "./clawdlets-config.js";
import type { RepoLayout } from "../repo-layout.js";
import { resolveHostNameOrExit } from "./host-resolve.js";

export type RepoContext = {
  repoRoot: string;
  layout: RepoLayout;
  config: ClawdletsConfig;
};

export type HostContext = RepoContext & {
  hostName: string;
  hostCfg: ClawdletsHostConfig;
};

export function loadRepoContext(params: { cwd: string; runtimeDir?: string }): RepoContext {
  const repoRoot = findRepoRoot(params.cwd);
  const { layout, config } = loadClawdletsConfig({ repoRoot, runtimeDir: params.runtimeDir });
  return { repoRoot, layout, config };
}

export function loadHostContextOrExit(params: { cwd: string; runtimeDir?: string; hostArg: unknown }): HostContext | null {
  const hostName = resolveHostNameOrExit({ cwd: params.cwd, runtimeDir: params.runtimeDir, hostArg: params.hostArg });
  if (!hostName) return null;
  const { repoRoot, layout, config } = loadRepoContext({ cwd: params.cwd, runtimeDir: params.runtimeDir });
  const hostCfg = config.hosts[hostName];
  if (!hostCfg) throw new Error(`missing host in fleet/clawdlets.json: ${hostName}`);
  return { repoRoot, layout, config, hostName, hostCfg };
}
