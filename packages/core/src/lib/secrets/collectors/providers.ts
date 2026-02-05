import { getLlmProviderFromModelId, getProviderAuthMode, getProviderCredentials } from "@clawlets/shared/lib/llm-provider-env";
import { canonicalizeEnvVar, extractEnvVarRef, isPlainObject } from "../env-vars.js";
import type { SecretSource } from "../secrets-plan.js";
import type { SecretsCollectorContext } from "./types.js";

function hasMappingForAnyOf(params: {
  anyOfEnv: string[];
  secretEnv: Record<string, string>;
  aliasMap: Map<string, string>;
}): boolean {
  for (const envVar of params.anyOfEnv) {
    const canonical = canonicalizeEnvVar(envVar, params.aliasMap);
    if (!canonical) continue;
    if (params.secretEnv[canonical]) return true;
  }
  return false;
}

function readConfiguredProviders(openclaw: unknown): Record<string, unknown> {
  if (!isPlainObject(openclaw)) return {};
  const models = openclaw.models;
  if (!isPlainObject(models)) return {};
  const providers = models.providers;
  if (!isPlainObject(providers)) return {};
  return providers;
}

export function collectProviderSecretRequirements(context: SecretsCollectorContext): void {
  const providersFromModels = new Set<string>();
  for (const model of context.models) {
    const provider = getLlmProviderFromModelId(model);
    if (provider) providersFromModels.add(provider);
  }

  const providersFromConfig = new Set<string>();
  const configuredProviders = readConfiguredProviders(context.openclaw);
  for (const [providerIdRaw, providerCfg] of Object.entries(configuredProviders)) {
    const providerId = String(providerIdRaw || "").trim();
    if (!providerId) continue;
    providersFromConfig.add(providerId);
    if (!isPlainObject(providerCfg)) continue;

    const apiKey = providerCfg.apiKey;
    if (typeof apiKey !== "string") continue;

    const envVar = extractEnvVarRef(apiKey);
    if (envVar) {
      context.addRequiredEnv(envVar, "provider", `models.providers.${providerId}.apiKey`);
      continue;
    }

    if (!apiKey.trim()) continue;
    const known = getProviderCredentials(providerId)
      .map((slot) => slot.anyOfEnv[0])
      .filter(Boolean);
    const suggested = known.length === 1 ? `\${${known[0]}}` : "${PROVIDER_API_KEY}";
    context.warnings.push({
      kind: "inlineApiKey",
      path: `models.providers.${providerId}.apiKey`,
      gateway: context.gatewayId,
      message: `Inline API key detected at models.providers.${providerId}.apiKey`,
      suggestion: `Replace with ${suggested} and wire it in fleet.secretEnv or hosts.${context.hostName}.gateways.${context.gatewayId}.profile.secretEnv.`,
    });
  }

  const usedProviders = new Set<string>([...providersFromModels, ...providersFromConfig]);
  for (const provider of usedProviders) {
    const auth = getProviderAuthMode(provider);
    const credentials = getProviderCredentials(provider);
    const sourcesForProvider: SecretSource[] = [];
    if (providersFromModels.has(provider)) sourcesForProvider.push("model");
    if (providersFromConfig.has(provider)) sourcesForProvider.push("provider");

    if (credentials.length === 0) {
      if (auth === "oauth") {
        context.warnings.push({
          kind: "auth",
          provider,
          gateway: context.gatewayId,
          message: `Provider ${provider} requires OAuth login (no env vars required).`,
        });
      }
      continue;
    }

    let hasAnyMapping = false;
    for (const slot of credentials) {
      if (slot.anyOfEnv.length === 0) continue;
      const canonical = slot.anyOfEnv[0]!;
      const mapped = hasMappingForAnyOf({
        anyOfEnv: slot.anyOfEnv,
        secretEnv: context.secretEnv,
        aliasMap: context.aliasMap,
      });
      if (mapped) hasAnyMapping = true;
      if (auth === "apiKey") {
        for (const source of sourcesForProvider) context.addRequiredEnv(canonical, source);
      } else if (auth === "mixed" && mapped) {
        for (const source of sourcesForProvider) context.addRequiredEnv(canonical, source);
      }
    }

    if ((auth === "oauth" || auth === "mixed") && !hasAnyMapping) {
      context.warnings.push({
        kind: "auth",
        provider,
        gateway: context.gatewayId,
        message: auth === "mixed"
          ? `Provider ${provider} supports OAuth or API key; no env wiring found (manual login required).`
          : `Provider ${provider} requires OAuth login (no env wiring found).`,
      });
    }
  }
}
