import fs from "node:fs";
import path from "node:path";
import { getRepoLayout, getHostOpenTofuDir, type RepoLayout } from "./repo-layout.js";
import { findRepoRoot } from "./lib/project/repo.js";
import {
  loadDeployCreds,
} from "./lib/infra/deploy-creds.js";
import {
  getSshExposureMode,
  loadClawletsConfig,
  type ClawletsHostConfig,
} from "./lib/config/clawlets-config.js";
import { addRepoChecks } from "./doctor/repo-checks.js";
import { addDeployChecks } from "./doctor/deploy-checks.js";
import type { DoctorCheck } from "./doctor/types.js";

export type { DoctorCheck } from "./doctor/types.js";

function readTfstateInstanceId(tfstatePath: string): { instanceId: string | null; error?: string } {
  try {
    const parsed = JSON.parse(fs.readFileSync(tfstatePath, "utf8")) as {
      outputs?: { instance_id?: { value?: unknown } };
    };
    const instanceId = String(parsed?.outputs?.instance_id?.value || "").trim();
    return { instanceId: instanceId || null };
  } catch (err) {
    return { instanceId: null, error: String((err as Error)?.message || err) };
  }
}

function addLockdownChecks(params: {
  repoRoot: string;
  layout: RepoLayout;
  host: string;
  hcloudToken?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  push: (c: DoctorCheck) => void;
}): void {
  const push = (c: Omit<DoctorCheck, "scope">) => params.push({ scope: "lockdown", ...c });

  let hostCfg: ClawletsHostConfig | null = null;
  try {
    const loaded = loadClawletsConfig({ repoRoot: params.repoRoot });
    hostCfg = loaded.config.hosts?.[params.host] ?? null;
  } catch (err) {
    push({ status: "missing", label: "clawlets config", detail: String((err as Error)?.message || err) });
    return;
  }

  if (!hostCfg) {
    push({ status: "missing", label: "host config", detail: `(missing host in fleet/clawlets.json: ${params.host})` });
    return;
  }

  push({
    status: hostCfg.enable ? "ok" : "missing",
    label: "host.enable",
    detail: hostCfg.enable ? "(true)" : `(false; set fleet/clawlets.json hosts.${params.host}.enable=true)`,
  });

  const sshExposureMode = getSshExposureMode(hostCfg);
  push({
    status: sshExposureMode === "tailnet" ? "ok" : "missing",
    label: "sshExposure",
    detail:
      sshExposureMode === "tailnet"
        ? "(mode=tailnet)"
        : `(mode=${sshExposureMode}; set sshExposure.mode=tailnet)`,
  });

  const tailnetMode = String(hostCfg.tailnet?.mode || "none");
  push({
    status: tailnetMode === "tailscale" ? "ok" : "missing",
    label: "tailnet configured",
    detail: tailnetMode === "tailscale" ? "(tailscale)" : `(tailnet.mode=${tailnetMode || "none"})`,
  });

  const targetHost = String(hostCfg.targetHost || "").trim();
  push({
    status: targetHost ? "ok" : "missing",
    label: "targetHost",
    detail: targetHost || "(unset; required for lockdown/server ops)",
  });

  const provider = String(hostCfg.provisioning?.provider || "hetzner").trim() || "hetzner";
  if (provider === "hetzner") {
    const hasToken = String(params.hcloudToken || "").trim().length > 0;
    push({
      status: hasToken ? "ok" : "missing",
      label: "provider credentials",
      detail: hasToken ? "(hetzner: HCLOUD_TOKEN set)" : "(hetzner requires HCLOUD_TOKEN)",
    });
  } else if (provider === "aws") {
    const accessKeyId = String(params.awsAccessKeyId || "").trim();
    const secretAccessKey = String(params.awsSecretAccessKey || "").trim();
    push({
      status: accessKeyId && secretAccessKey ? "ok" : "missing",
      label: "provider credentials",
      detail:
        accessKeyId && secretAccessKey
          ? "(aws: access key + secret key set)"
          : "(aws requires AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY)",
    });
  } else {
    push({
      status: "missing",
      label: "provider credentials",
      detail: `(unsupported provisioning.provider: ${provider || "(unset)"})`,
    });
    return;
  }

  const tfstatePath = path.join(getHostOpenTofuDir(params.layout, params.host), "providers", provider, "terraform.tfstate");
  if (!fs.existsSync(tfstatePath)) {
    push({ status: "missing", label: "infra state", detail: `(missing: ${tfstatePath})` });
    return;
  }

  const tfstate = readTfstateInstanceId(tfstatePath);
  if (tfstate.error) {
    push({ status: "missing", label: "infra state", detail: `(invalid JSON: ${tfstatePath}; ${tfstate.error})` });
    return;
  }
  push({
    status: tfstate.instanceId ? "ok" : "missing",
    label: "infra state",
    detail: tfstate.instanceId
      ? `(provider=${provider}; instance_id=${tfstate.instanceId})`
      : `(outputs.instance_id missing: ${tfstatePath})`,
  });
}

export async function collectDoctorChecks(params: {
  cwd: string;
  runtimeDir?: string;
  envFile?: string;
  host: string;
  scope?: "repo" | "bootstrap" | "updates" | "lockdown" | "all";
  skipGithubTokenCheck?: boolean;
}): Promise<DoctorCheck[]> {
  const deployCreds = loadDeployCreds({ cwd: params.cwd, runtimeDir: params.runtimeDir, envFile: params.envFile });

  const repoRoot = findRepoRoot(params.cwd);
  const layout = getRepoLayout(repoRoot, params.runtimeDir);

  const wantRepo = params.scope === "repo" || params.scope === "all" || params.scope == null;
  const wantBootstrap = params.scope === "bootstrap" || params.scope === "all" || params.scope == null;
  const wantUpdates = params.scope === "updates" || params.scope === "all" || params.scope == null;
  const wantLockdown = params.scope === "lockdown" || params.scope === "all" || params.scope == null;

  const checks: DoctorCheck[] = [];
  const push = (c: DoctorCheck) => {
    if (c.scope === "repo" && !wantRepo) return;
    if (c.scope === "bootstrap" && !wantBootstrap) return;
    if (c.scope === "updates" && !wantUpdates) return;
    if (c.scope === "lockdown" && !wantLockdown) return;
    checks.push(c);
  };

  const HCLOUD_TOKEN = deployCreds.values.HCLOUD_TOKEN;
  const AWS_ACCESS_KEY_ID = deployCreds.values.AWS_ACCESS_KEY_ID;
  const AWS_SECRET_ACCESS_KEY = deployCreds.values.AWS_SECRET_ACCESS_KEY;
  const NIX_BIN = deployCreds.values.NIX_BIN || "nix";
  const GITHUB_TOKEN = deployCreds.values.GITHUB_TOKEN;
  const SOPS_AGE_KEY_FILE = deployCreds.values.SOPS_AGE_KEY_FILE;

  const host = params.host.trim() || "openclaw-fleet-host";

  let fleetGateways: string[] | null = null;
  if (wantRepo) {
    const repoResult = await addRepoChecks({
      repoRoot,
      layout,
      host,
      nixBin: NIX_BIN,
      push,
    });
    fleetGateways = repoResult.fleetGateways;
  }

  if ((wantBootstrap || wantLockdown) && deployCreds.envFile && deployCreds.envFile.status !== "ok") {
    const detail = deployCreds.envFile.error
      ? `${deployCreds.envFile.path} (${deployCreds.envFile.error})`
      : deployCreds.envFile.path;
    if (wantBootstrap) push({ scope: "bootstrap", status: "missing", label: "deploy env file", detail });
    if (wantLockdown) push({ scope: "lockdown", status: "missing", label: "deploy env file", detail });
  }

  if (wantBootstrap) {
    await addDeployChecks({
      cwd: params.cwd,
      repoRoot,
      layout,
      host,
      nixBin: NIX_BIN,
      hcloudToken: HCLOUD_TOKEN,
      sopsAgeKeyFile: SOPS_AGE_KEY_FILE,
      githubToken: GITHUB_TOKEN,
      fleetGateways,
      push,
      skipGithubTokenCheck: params.skipGithubTokenCheck,
      scope: "bootstrap",
    });
  }

  if (wantUpdates) {
    await addDeployChecks({
      cwd: params.cwd,
      repoRoot,
      layout,
      host,
      nixBin: NIX_BIN,
      hcloudToken: HCLOUD_TOKEN,
      sopsAgeKeyFile: SOPS_AGE_KEY_FILE,
      githubToken: GITHUB_TOKEN,
      fleetGateways,
      push,
      skipGithubTokenCheck: params.skipGithubTokenCheck,
      scope: "updates",
    });
  }

  if (wantLockdown) {
    addLockdownChecks({
      repoRoot,
      layout,
      host,
      hcloudToken: HCLOUD_TOKEN,
      awsAccessKeyId: AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: AWS_SECRET_ACCESS_KEY,
      push,
    });
  }

  return checks;
}
