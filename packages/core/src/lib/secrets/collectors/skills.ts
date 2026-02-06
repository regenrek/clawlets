import { extractEnvVarRef, isPlainObject, skillApiKeyEnvVar } from "../env-vars.js";
import type { SecretsCollectorContext } from "./types.js";

function addSkillApiKeyRequirement(params: {
  context: SecretsCollectorContext;
  skill: string;
  path: string;
  value: unknown;
}): void {
  if (typeof params.value !== "string") return;
  const trimmed = params.value.trim();
  if (!trimmed) return;

  const expectedEnvVar = skillApiKeyEnvVar(params.skill);
  if (!params.context.envVarHelpOverrides.has(expectedEnvVar)) {
    params.context.envVarHelpOverrides.set(expectedEnvVar, `Skill ${params.skill} API key`);
  }

  const envVar = extractEnvVarRef(trimmed);
  if (envVar && envVar !== expectedEnvVar) {
    params.context.warnings.push({
      kind: "inlineApiKey",
      gateway: params.context.gatewayId,
      path: params.path,
      message: `Unexpected env ref at ${params.path}: ${trimmed}`,
      suggestion: `Use \${${expectedEnvVar}} and map it in fleet.secretEnv or hosts.<host>.gateways.${params.context.gatewayId}.profile.secretEnv.`,
    });
  }

  if (!envVar) {
    params.context.warnings.push({
      kind: "inlineApiKey",
      gateway: params.context.gatewayId,
      path: params.path,
      message: `Inline API key detected at ${params.path}`,
      suggestion: `Replace with \${${expectedEnvVar}} and map it in fleet.secretEnv or hosts.<host>.gateways.${params.context.gatewayId}.profile.secretEnv.`,
    });
  }

  params.context.addRequiredEnv(expectedEnvVar, "custom", params.path);
}

export function collectSkillSecretRequirements(context: SecretsCollectorContext): void {
  if (!isPlainObject(context.openclaw)) return;
  const skills = context.openclaw.skills;
  if (!isPlainObject(skills)) return;

  const entries = skills.entries;
  if (!isPlainObject(entries)) return;
  for (const [skill, entry] of Object.entries(entries)) {
    if (!isPlainObject(entry)) continue;
    addSkillApiKeyRequirement({
      context,
      skill,
      path: `skills.entries.${skill}.apiKey`,
      value: entry.apiKey,
    });
  }
}
