import { extractEnvVarRef, HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR, HOOKS_TOKEN_ENV_VAR, isPlainObject } from "../env-vars.js";
import type { SecretsCollectorContext } from "./types.js";

function addHookTokenRequirement(params: {
  context: SecretsCollectorContext;
  envVar: string;
  path: string;
  value: unknown;
  label: string;
}): void {
  if (typeof params.value !== "string") return;
  const trimmed = params.value.trim();
  if (!trimmed) return;

  const envVar = extractEnvVarRef(trimmed);
  if (envVar && envVar !== params.envVar) {
    params.context.warnings.push({
      kind: "inlineToken",
      channel: "hooks",
      gateway: params.context.gatewayId,
      path: params.path,
      message: `Unexpected env ref at ${params.path}: ${trimmed}`,
      suggestion: `Use \${${params.envVar}} for ${params.label} and map it in fleet.secretEnv or hosts.<host>.gateways.${params.context.gatewayId}.profile.secretEnv.`,
    });
  }

  if (!envVar) {
    params.context.warnings.push({
      kind: "inlineToken",
      channel: "hooks",
      gateway: params.context.gatewayId,
      path: params.path,
      message: `Inline hooks token detected at ${params.path}`,
      suggestion: `Replace with \${${params.envVar}} and map it in fleet.secretEnv or hosts.<host>.gateways.${params.context.gatewayId}.profile.secretEnv.`,
    });
  }

  params.context.addRequiredEnv(params.envVar, "custom", params.path);
}

export function collectHookSecretRequirements(context: SecretsCollectorContext): void {
  if (!isPlainObject(context.openclaw)) return;
  const hooks = context.openclaw.hooks;
  if (!isPlainObject(hooks)) return;

  addHookTokenRequirement({
    context,
    envVar: HOOKS_TOKEN_ENV_VAR,
    path: "hooks.token",
    value: hooks.token,
    label: "hooks.token",
  });

  const gmail = hooks.gmail;
  if (!isPlainObject(gmail)) return;
  addHookTokenRequirement({
    context,
    envVar: HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR,
    path: "hooks.gmail.pushToken",
    value: gmail.pushToken,
    label: "hooks.gmail.pushToken",
  });
}
