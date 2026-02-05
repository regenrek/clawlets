import fs from "node:fs";
import path from "node:path";
import { expandPath } from "../path-expand.js";
import { getSshExposureMode, getTailnetMode } from "../config/resolve-host.js";
import type { ClawletsHostConfig } from "../config/schema.js";
import type { HostProvisionSpec, HostProvisionSpecBase } from "./types.js";
import { getProvisionSpecBuilder } from "./providers/index.js";

export function buildHostProvisionSpec(params: {
  repoRoot: string;
  hostName: string;
  hostCfg: ClawletsHostConfig;
}): HostProvisionSpec {
  const provider = params.hostCfg.provisioning?.provider ?? "hetzner";
  const diskDevice = String(params.hostCfg.diskDevice || "/dev/sda").trim();

  const adminCidr = String(params.hostCfg.provisioning?.adminCidr || "").trim();
  if (!adminCidr) {
    throw new Error(`missing provisioning.adminCidr for ${params.hostName} (set via: clawlets host set --admin-cidr ...)`);
  }

  const sshPubkeyFileRaw = String(params.hostCfg.provisioning?.sshPubkeyFile || "").trim();
  if (!sshPubkeyFileRaw) {
    throw new Error(`missing provisioning.sshPubkeyFile for ${params.hostName} (set via: clawlets host set --ssh-pubkey-file ...)`);
  }
  const sshPubkeyFileExpanded = expandPath(sshPubkeyFileRaw);
  const sshPubkeyFile = path.isAbsolute(sshPubkeyFileExpanded)
    ? sshPubkeyFileExpanded
    : path.resolve(params.repoRoot, sshPubkeyFileExpanded);
  if (!fs.existsSync(sshPubkeyFile)) {
    throw new Error(`ssh pubkey file not found: ${sshPubkeyFile}`);
  }
  const publicKey = fs.readFileSync(sshPubkeyFile, "utf8").trim();
  if (!publicKey) {
    throw new Error(`ssh pubkey file is empty: ${sshPubkeyFile}`);
  }

  const base: HostProvisionSpecBase = {
    hostName: params.hostName,
    provider,
    diskDevice,
    sshExposureMode: getSshExposureMode(params.hostCfg),
    tailnetMode: getTailnetMode(params.hostCfg),
    ssh: {
      adminCidr,
      adminCidrAllowWorldOpen: Boolean(params.hostCfg.provisioning?.adminCidrAllowWorldOpen),
      publicKeyPath: sshPubkeyFile,
      publicKey,
    },
  };

  const builder = getProvisionSpecBuilder(provider);
  return builder({ base, hostCfg: params.hostCfg, hostName: params.hostName });
}
