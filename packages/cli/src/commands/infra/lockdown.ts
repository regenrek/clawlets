import process from "node:process";
import { defineCommand } from "citty";
import { loadDeployCreds } from "@clawlets/core/lib/infra/deploy-creds";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { loadClawletsConfig } from "@clawlets/core/lib/config/clawlets-config";
import { getHostOpenTofuDir } from "@clawlets/core/repo-layout";
import { requireDeployGate } from "../../lib/deploy-gate.js";
import { resolveHostNameOrExit } from "@clawlets/core/lib/host/host-resolve";
import { buildHostProvisionSpec, getProvisionerDriver } from "@clawlets/core/lib/infra/infra";
import { resolveHostProvisioningConfig } from "../../lib/provisioning-ssh-pubkey-file.js";
import { buildProvisionerRuntime } from "./provider-runtime.js";

export const lockdown = defineCommand({
  meta: {
    name: "lockdown",
    description: "Remove public SSH exposure via provider-specific lockdown.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    skipTofu: { type: "boolean", description: "Skip provisioning apply.", default: false },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repoRoot = findRepoRoot(cwd);
    const hostName = resolveHostNameOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!hostName) return;

    await requireDeployGate({
      runtimeDir: (args as any).runtimeDir,
      envFile: (args as any).envFile,
      host: hostName,
      scope: "lockdown",
      strict: true,
      skipGithubTokenCheck: true,
    });

    const { layout, config: clawletsConfig } = loadClawletsConfig({ repoRoot, runtimeDir: (args as any).runtimeDir });
    if (!clawletsConfig.hosts[hostName]) throw new Error(`missing host in fleet/clawlets.json: ${hostName}`);
    const hostProvisioningConfig = resolveHostProvisioningConfig({
      repoRoot,
      layout,
      config: clawletsConfig,
      hostName,
    });
    const opentofuDir = getHostOpenTofuDir(layout, hostName);
    const spec = buildHostProvisionSpec({ repoRoot, hostName, hostCfg: hostProvisioningConfig.hostCfg });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });

    const driver = getProvisionerDriver(spec.provider);
    const runtime = buildProvisionerRuntime({
      repoRoot,
      opentofuDir,
      dryRun: args.dryRun,
      deployCreds,
    });

    if (!args.skipTofu) {
      await driver.lockdown({ spec, runtime });
    }
  },
});
