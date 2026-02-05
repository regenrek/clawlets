import type { ProvisionerDriver, ProvisionerRuntime, HetznerProvisionSpec, ProvisionedHost } from "../../types.js";
import { applyOpenTofuVars, destroyOpenTofuVars } from "../../../opentofu.js";
import { capture } from "../../../run.js";
import { withFlakesEnv } from "../../../nix-flakes.js";

function requireHcloudToken(runtime: ProvisionerRuntime): string {
  const token = String(runtime.credentials.hcloudToken || "").trim();
  if (!token) {
    throw new Error("missing HCLOUD_TOKEN (set in .clawlets/env or env var; run: clawlets env init)");
  }
  return token;
}

function buildTofuEnv(spec: HetznerProvisionSpec, runtime: ProvisionerRuntime, hcloudToken: string): NodeJS.ProcessEnv {
  return withFlakesEnv({
    ...process.env,
    HCLOUD_TOKEN: hcloudToken,
    ADMIN_CIDR: spec.ssh.adminCidr,
    SSH_PUBKEY_FILE: spec.ssh.publicKeyPath,
    SERVER_TYPE: spec.hetzner.serverType,
  });
}

async function readOutput(params: {
  name: string;
  runtime: ProvisionerRuntime;
  spec: HetznerProvisionSpec;
  hcloudToken: string;
}): Promise<string> {
  if (params.runtime.dryRun) return `<opentofu-output:${params.name}>`;
  const out = await capture(
    params.runtime.nixBin,
    ["run", "--impure", "nixpkgs#opentofu", "--", "output", "-raw", params.name],
    { cwd: params.runtime.opentofuDir, env: buildTofuEnv(params.spec, params.runtime, params.hcloudToken), dryRun: params.runtime.dryRun },
  );
  return String(out || "").trim();
}

async function applyHetzner(spec: HetznerProvisionSpec, runtime: ProvisionerRuntime): Promise<void> {
  const hcloudToken = requireHcloudToken(runtime);
  await applyOpenTofuVars({
    opentofuDir: runtime.opentofuDir,
    vars: {
      hostName: spec.hostName,
      hcloudToken,
      adminCidr: spec.ssh.adminCidr,
      adminCidrIsWorldOpen: spec.ssh.adminCidrAllowWorldOpen,
      sshPubkeyFile: spec.ssh.publicKeyPath,
      serverType: spec.hetzner.serverType,
      image: spec.hetzner.image,
      location: spec.hetzner.location,
      sshExposureMode: spec.sshExposureMode,
      tailnetMode: spec.tailnetMode,
    },
    nixBin: runtime.nixBin,
    dryRun: runtime.dryRun,
    redact: runtime.redact,
  });
}

async function destroyHetzner(spec: HetznerProvisionSpec, runtime: ProvisionerRuntime): Promise<void> {
  const hcloudToken = requireHcloudToken(runtime);
  await destroyOpenTofuVars({
    opentofuDir: runtime.opentofuDir,
    vars: {
      hostName: spec.hostName,
      hcloudToken,
      adminCidr: spec.ssh.adminCidr,
      adminCidrIsWorldOpen: spec.ssh.adminCidrAllowWorldOpen,
      sshPubkeyFile: spec.ssh.publicKeyPath,
      serverType: spec.hetzner.serverType,
      image: spec.hetzner.image,
      location: spec.hetzner.location,
      sshExposureMode: spec.sshExposureMode,
      tailnetMode: spec.tailnetMode,
    },
    nixBin: runtime.nixBin,
    dryRun: runtime.dryRun,
    redact: runtime.redact,
  });
}

export const hetznerProvisionerDriver: ProvisionerDriver = {
  id: "hetzner",
  async provision({ spec, runtime }): Promise<ProvisionedHost> {
    if (spec.provider !== "hetzner") {
      throw new Error(`hetzner driver received provider=${spec.provider}`);
    }
    await applyHetzner(spec, runtime);

    const hcloudToken = requireHcloudToken(runtime);
    const ipv4 = await readOutput({ name: "ipv4", runtime, spec, hcloudToken });
    const instanceId = await readOutput({ name: "instance_id", runtime, spec, hcloudToken });

    return {
      hostName: spec.hostName,
      provider: "hetzner",
      instanceId,
      ipv4,
      sshUser: "root",
    };
  },
  async destroy({ spec, runtime }): Promise<void> {
    if (spec.provider !== "hetzner") {
      throw new Error(`hetzner driver received provider=${spec.provider}`);
    }
    await destroyHetzner(spec, runtime);
  },
  async lockdown({ spec, runtime }): Promise<void> {
    if (spec.provider !== "hetzner") {
      throw new Error(`hetzner driver received provider=${spec.provider}`);
    }
    await applyHetzner(spec, runtime);
  },
};
