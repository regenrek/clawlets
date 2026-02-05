import type { SecretSource, SecretSpec, SecretsPlanWarning } from "./secrets-plan.js";
import type { SecretFileSpec } from "./secret-wiring.js";
import {
  ENV_VAR_HELP,
  HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR,
  HOOKS_TOKEN_ENV_VAR,
  type DerivedSecretEnvEntry,
  buildBaseSecretEnv,
  buildDerivedSecretEnv,
  buildEnvVarAliasMap,
  canonicalizeEnvVar,
  collectDerivedSecretEnvEntries,
  collectGatewayModels,
  extractEnvVarRef,
  isPlainObject,
  isWhatsAppEnabled,
  normalizeEnvKey,
  skillApiKeyEnvVar,
  suggestSecretNameForEnvVar,
} from "./secrets/env-vars.js";
import { collectChannelSecretRequirements } from "./secrets/collectors/channels/index.js";
import { collectHookSecretRequirements } from "./secrets/collectors/hooks.js";
import { collectSkillSecretRequirements } from "./secrets/collectors/skills.js";
import { collectProviderSecretRequirements } from "./secrets/collectors/providers.js";
import type { AddRequiredEnv as CollectorAddRequiredEnv } from "./secrets/collectors/types.js";

export {
  ENV_VAR_HELP,
  HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR,
  HOOKS_TOKEN_ENV_VAR,
  type DerivedSecretEnvEntry,
  buildBaseSecretEnv,
  buildDerivedSecretEnv,
  buildEnvVarAliasMap,
  canonicalizeEnvVar,
  collectDerivedSecretEnvEntries,
  collectGatewayModels,
  extractEnvVarRef,
  isPlainObject,
  isWhatsAppEnabled,
  normalizeEnvKey,
  skillApiKeyEnvVar,
  suggestSecretNameForEnvVar,
};

export type SecretSpecAccumulator = {
  name: string;
  kind: SecretSpec["kind"];
  scope: SecretSpec["scope"];
  sources: Set<SecretSource>;
  envVars: Set<string>;
  gateways: Set<string>;
  help?: string;
  optional: boolean;
  fileId?: string;
};

const SOURCE_PRIORITY: SecretSource[] = ["channel", "model", "provider", "custom"];

type AddRequiredEnv = CollectorAddRequiredEnv;

export function applyChannelEnvRequirements(params: {
  gatewayId: string;
  openclaw: unknown;
  warnings: SecretsPlanWarning[];
  addRequiredEnv: AddRequiredEnv;
}): void {
  collectChannelSecretRequirements({
    gatewayId: params.gatewayId,
    hostName: "",
    openclaw: params.openclaw,
    warnings: params.warnings,
    addRequiredEnv: params.addRequiredEnv,
    envVarHelpOverrides: new Map<string, string>(),
    models: [],
    secretEnv: {},
    aliasMap: new Map<string, string>(),
  });
}

export function applyHookEnvRequirements(params: {
  gatewayId: string;
  openclaw: unknown;
  warnings: SecretsPlanWarning[];
  addRequiredEnv: AddRequiredEnv;
}): void {
  collectHookSecretRequirements({
    gatewayId: params.gatewayId,
    hostName: "",
    openclaw: params.openclaw,
    warnings: params.warnings,
    addRequiredEnv: params.addRequiredEnv,
    envVarHelpOverrides: new Map<string, string>(),
    models: [],
    secretEnv: {},
    aliasMap: new Map<string, string>(),
  });
}

export function applySkillEnvRequirements(params: {
  gatewayId: string;
  openclaw: unknown;
  warnings: SecretsPlanWarning[];
  addRequiredEnv: AddRequiredEnv;
  envVarHelpOverrides: Map<string, string>;
}): void {
  collectSkillSecretRequirements({
    gatewayId: params.gatewayId,
    hostName: "",
    openclaw: params.openclaw,
    warnings: params.warnings,
    addRequiredEnv: params.addRequiredEnv,
    envVarHelpOverrides: params.envVarHelpOverrides,
    models: [],
    secretEnv: {},
    aliasMap: new Map<string, string>(),
  });
}

export function applyProviderEnvRequirements(params: {
  hostName: string;
  gatewayId: string;
  openclaw: unknown;
  warnings: SecretsPlanWarning[];
  addRequiredEnv: AddRequiredEnv;
  models: string[];
  secretEnv: Record<string, string>;
  aliasMap: Map<string, string>;
}): void {
  collectProviderSecretRequirements({
    gatewayId: params.gatewayId,
    hostName: params.hostName,
    openclaw: params.openclaw,
    warnings: params.warnings,
    addRequiredEnv: params.addRequiredEnv,
    envVarHelpOverrides: new Map<string, string>(),
    models: params.models,
    secretEnv: params.secretEnv,
    aliasMap: params.aliasMap,
  });
}

export function pickPrimarySource(sources: Set<SecretSource>): SecretSource {
  for (const source of SOURCE_PRIORITY) {
    if (sources.has(source)) return source;
  }
  return "custom";
}

export function recordSecretSpec(
  map: Map<string, SecretSpecAccumulator>,
  params: {
    name: string;
    kind: SecretSpec["kind"];
    scope: SecretSpec["scope"];
    source: SecretSource;
    optional: boolean;
    envVar?: string;
    gateway?: string;
    help?: string;
    fileId?: string;
  },
): void {
  const key = params.name;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      name: params.name,
      kind: params.kind,
      scope: params.scope,
      sources: new Set([params.source]),
      envVars: new Set(params.envVar ? [params.envVar] : []),
      gateways: new Set(params.gateway ? [params.gateway] : []),
      help: params.help,
      optional: params.optional,
      fileId: params.fileId,
    });
    return;
  }

  existing.sources.add(params.source);
  if (params.envVar) existing.envVars.add(params.envVar);
  if (params.gateway) existing.gateways.add(params.gateway);
  if (params.help && !existing.help) existing.help = params.help;
  if (!params.optional) existing.optional = false;
  if (existing.scope !== params.scope) {
    existing.scope = existing.scope === "host" || params.scope === "host" ? "host" : "gateway";
  }
  if (!existing.fileId && params.fileId) existing.fileId = params.fileId;
}

export function normalizeSecretFiles(value: unknown): Record<string, SecretFileSpec> {
  if (!isPlainObject(value)) return {};
  return value as Record<string, SecretFileSpec>;
}

export function normalizeEnvVarPaths(pathsByVar: Record<string, string[]>): void {
  for (const [envVar, paths] of Object.entries(pathsByVar)) {
    if (!paths || paths.length === 0) continue;
    pathsByVar[envVar] = Array.from(new Set(paths)).sort();
  }
}
