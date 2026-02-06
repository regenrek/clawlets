import type { SecretsPlanWarning } from "../../secrets-plan.js";
import { extractEnvVarRef } from "../../env-vars.js";
import type { AddRequiredEnv } from "../types.js";

type ChannelTokenParams = {
  channel: string;
  gatewayId: string;
  envVar: string;
  path: string;
  value: unknown;
  warnings: SecretsPlanWarning[];
  addRequiredEnv: AddRequiredEnv;
};

export function addChannelTokenRequirement(params: ChannelTokenParams): void {
  if (typeof params.value !== "string") return;
  const trimmed = params.value.trim();
  if (!trimmed) return;

  const envVar = extractEnvVarRef(trimmed);
  if (envVar && envVar !== params.envVar) {
    params.warnings.push({
      kind: "inlineToken",
      channel: params.channel,
      gateway: params.gatewayId,
      path: params.path,
      message: `Unexpected env ref at ${params.path}: ${trimmed}`,
      suggestion: `Use \${${params.envVar}} for ${params.channel} and map it in fleet.secretEnv or hosts.<host>.gateways.${params.gatewayId}.profile.secretEnv.`,
    });
  }

  if (!envVar) {
    params.warnings.push({
      kind: "inlineToken",
      channel: params.channel,
      gateway: params.gatewayId,
      path: params.path,
      message: `Inline ${params.channel} token detected at ${params.path}`,
      suggestion: `Replace with \${${params.envVar}} and map it in fleet.secretEnv or hosts.<host>.gateways.${params.gatewayId}.profile.secretEnv.`,
    });
  }

  params.addRequiredEnv(params.envVar, "channel", params.path);
}
