import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { agePublicKeyFromIdentityFile } from "../security/age-keygen.js";
import { sopsDecryptYamlFile } from "../security/sops.js";
import { getHostAgeKeySopsCreationRulePathRegex, getHostSecretsSopsCreationRulePathRegex } from "../security/sops-rules.js";
import { getSopsCreationRuleAgeRecipients } from "../security/sops-config.js";
import { mapWithConcurrency } from "../runtime/concurrency.js";
import { getHostSecretsDir, type RepoLayout } from "../../repo-layout.js";
import { buildFleetSecretsPlan } from "./plan/index.js";
import { resolveSecretsPlanScope } from "./secrets-plan-scopes.js";
import { isPlaceholderSecretValue } from "./secrets-init.js";
import type { ClawletsConfig } from "../config/index.js";
import type { SecretsPlanScope } from "./secrets-plan.js";
import { coerceString, formatUnknown } from "@clawlets/shared/lib/strings";

export type SecretsStatusRow = {
  secret: string;
  status: "ok" | "missing" | "warn";
  detail?: string;
};

export type SecretsStatusReport = {
  host: string;
  localDir: string;
  results: SecretsStatusRow[];
};

function uniqSorted(values: string[]): string[] {
  return Array.from(new Set(values)).toSorted();
}

export function summarizeSecretsStatusResults(results: SecretsStatusRow[]): {
  ok: number;
  missing: number;
  warn: number;
  total: number;
} {
  let ok = 0;
  let missing = 0;
  let warn = 0;
  for (const row of results) {
    if (row.status === "ok") ok += 1;
    else if (row.status === "missing") missing += 1;
    else if (row.status === "warn") warn += 1;
  }
  return { ok, missing, warn, total: results.length };
}

export async function collectSecretsStatus(params: {
  layout: RepoLayout;
  config: ClawletsConfig;
  hostName: string;
  scope: SecretsPlanScope | "all";
  operatorKeyPath?: string;
  nix: {
    nixBin: string;
    cwd: string;
    dryRun: boolean;
  };
}): Promise<SecretsStatusReport> {
  const hostName = String(params.hostName || "").trim();
  if (!hostName) throw new Error("hostName required");
  const localDir = getHostSecretsDir(params.layout, hostName);
  const secretsPlan = buildFleetSecretsPlan({ config: params.config, hostName, scope: params.scope });
  const scopeSummary =
    params.scope === "all"
      ? {
          requiredNames: uniqSorted((secretsPlan.required || []).map((spec) => spec.name)),
          optionalNames: uniqSorted((secretsPlan.optional || []).map((spec) => spec.name)),
        }
      : resolveSecretsPlanScope({ scopes: secretsPlan.scopes, optional: secretsPlan.optional, scope: params.scope });
  const requiredSecretNames = new Set<string>(scopeSummary.requiredNames);
  const secretNames = Array.from(new Set<string>([
    ...scopeSummary.requiredNames,
    ...scopeSummary.optionalNames,
  ])).toSorted();
  const optionalSecrets = params.scope === "openclaw" ? [] : ["root_password_hash"];

  const results: SecretsStatusRow[] = [];
  const preflight: SecretsStatusRow[] = [];
  const operatorKeyPath = String(params.operatorKeyPath || "").trim();

  if (!operatorKeyPath || !fs.existsSync(operatorKeyPath)) {
    preflight.push({ secret: "SOPS_AGE_KEY_FILE", status: "missing", detail: operatorKeyPath || "missing" });
  }

  const formatRecipients = (recipients: string[]) => (recipients.length ? recipients.join(", ") : "(none)");
  let operatorPublicKey = "";
  if (operatorKeyPath && fs.existsSync(operatorKeyPath)) {
    try {
      operatorPublicKey = await agePublicKeyFromIdentityFile(operatorKeyPath, params.nix);
    } catch (error) {
      preflight.push({
        secret: "SOPS_AGE_KEY_FILE",
        status: "missing",
        detail: `failed to derive operator public key: ${String((error as Error)?.message || error)}`,
      });
    }
  }

  if (operatorPublicKey && fs.existsSync(params.layout.sopsConfigPath)) {
    const sopsText = fs.readFileSync(params.layout.sopsConfigPath, "utf8");
    const hostSecretsRule = getHostSecretsSopsCreationRulePathRegex(params.layout, hostName);
    const hostKeyRule = getHostAgeKeySopsCreationRulePathRegex(params.layout, hostName);
    const hostSecretsRecipients = getSopsCreationRuleAgeRecipients({ existingYaml: sopsText, pathRegex: hostSecretsRule });
    const hostKeyRecipients = getSopsCreationRuleAgeRecipients({ existingYaml: sopsText, pathRegex: hostKeyRule });

    if (hostSecretsRecipients.length > 0 && !hostSecretsRecipients.includes(operatorPublicKey)) {
      preflight.push({
        secret: "sops recipients (host secrets)",
        status: "missing",
        detail: `operator key ${operatorPublicKey} not in recipients: ${formatRecipients(hostSecretsRecipients)}`,
      });
    }
    if (hostKeyRecipients.length > 0 && !hostKeyRecipients.includes(operatorPublicKey)) {
      preflight.push({
        secret: "sops recipients (host age key)",
        status: "missing",
        detail: `operator key ${operatorPublicKey} not in recipients: ${formatRecipients(hostKeyRecipients)}`,
      });
    }
  }

  if (preflight.length > 0) {
    return {
      host: hostName,
      localDir,
      results: preflight,
    };
  }

  const verifyOne = async (secretName: string, optional: boolean, allowOptionalMarker: boolean): Promise<SecretsStatusRow> => {
    const filePath = path.join(localDir, `${secretName}.yaml`);
    if (!fs.existsSync(filePath)) {
      return { secret: secretName, status: optional ? "warn" : "missing", detail: `(missing: ${filePath})` };
    }
    try {
      const decrypted = await sopsDecryptYamlFile({ filePath, ageKeyFile: operatorKeyPath, nix: params.nix });
      const parsed = (YAML.parse(decrypted) as Record<string, unknown>) || {};
      const keys = Object.keys(parsed).filter((k) => k !== "sops");
      if (keys.length !== 1 || keys[0] !== secretName) {
        return { secret: secretName, status: "missing", detail: "(invalid: expected exactly 1 key matching filename)" };
      }
      const valueRaw = parsed[secretName];
      const value = typeof valueRaw === "string" ? valueRaw : coerceString(valueRaw);
      if (!allowOptionalMarker && value.trim() === "<OPTIONAL>") {
        return { secret: secretName, status: "missing", detail: "(placeholder: <OPTIONAL>)" };
      }
      if (isPlaceholderSecretValue(value)) {
        return { secret: secretName, status: "missing", detail: `(placeholder: ${value.trim()})` };
      }
      if (!optional && !value.trim()) {
        return { secret: secretName, status: "missing", detail: "(empty)" };
      }
      return { secret: secretName, status: "ok" };
    } catch (error) {
      return { secret: secretName, status: "missing", detail: formatUnknown(error) };
    }
  };

  if (!fs.existsSync(localDir)) {
    results.push({ secret: "secrets.localDir", status: "missing", detail: localDir });
  } else {
    const checks = [
      ...secretNames.map((secretName) => ({
        secretName,
        optional: false,
        allowOptionalMarker: !requiredSecretNames.has(secretName),
      })),
      ...optionalSecrets.map((secretName) => ({
        secretName,
        optional: true,
        allowOptionalMarker: true,
      })),
    ];
    const checked = await mapWithConcurrency({
      items: checks,
      concurrency: 4,
      fn: async (check) => await verifyOne(check.secretName, check.optional, check.allowOptionalMarker),
    });
    results.push(...checked);
  }

  return {
    host: hostName,
    localDir,
    results,
  };
}
