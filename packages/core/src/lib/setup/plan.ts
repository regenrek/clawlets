import { HostNameSchema, SecretNameSchema } from "@clawlets/shared/lib/identifiers";

import { DEPLOY_CREDS_KEYS } from "../infra/deploy-creds.js";
import { assertSafeRecordKey, createNullProtoRecord } from "../runtime/safe-record.js";
import { validateSetupApplyConfigMutation } from "./shared.js";

export type SetupDraftInfrastructure = {
  serverType?: string;
  image?: string;
  location?: string;
  allowTailscaleUdpIngress?: boolean;
  volumeEnabled?: boolean;
  volumeSizeGb?: number;
};

export type SetupDraftConnection = {
  adminCidr?: string;
  sshExposureMode?: "bootstrap" | "tailnet" | "public";
  sshKeyCount?: number;
  sshAuthorizedKeys?: string[];
};

export type SetupDraftNonSecret = {
  infrastructure?: SetupDraftInfrastructure;
  connection?: SetupDraftConnection;
};

export type SetupApplyConfigMutation = {
  path: string;
  value?: string;
  valueJson?: string;
  del: boolean;
};

export type SetupApplyPlan = {
  schemaVersion: 1;
  hostName: string;
  targetRunnerId: string;
  configMutations: SetupApplyConfigMutation[];
};

export type SetupApplyExecutionInput = {
  hostName: string;
  configMutations: SetupApplyConfigMutation[];
  deployCreds: Record<string, string>;
  bootstrapSecrets: Record<string, string>;
};

function requireTrimmedString(raw: unknown, field: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new Error(`${field} required`);
  if (value.includes("\0") || value.includes("\r") || value.includes("\n")) {
    throw new Error(`${field} invalid`);
  }
  return value;
}

function parseOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (value.includes("\0") || value.includes("\r") || value.includes("\n")) {
    throw new Error("string field invalid");
  }
  return value;
}

function normalizeAuthorizedKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((value) => requireTrimmedString(value, "connection.sshAuthorizedKeys[]"))
        .filter(Boolean),
    ),
  );
}

function normalizeExposureMode(raw: unknown): "bootstrap" | "tailnet" | "public" {
  const value = parseOptionalString(raw) ?? "bootstrap";
  if (value === "bootstrap" || value === "tailnet" || value === "public") return value;
  throw new Error("connection.sshExposureMode invalid");
}

function normalizeConfigMutations(params: {
  hostName: string;
  draft: SetupDraftNonSecret;
}): SetupApplyConfigMutation[] {
  const infrastructure = params.draft.infrastructure ?? {};
  const connection = params.draft.connection ?? {};
  const hostName = HostNameSchema.parse(params.hostName);
  const serverType = requireTrimmedString(infrastructure.serverType, "infrastructure.serverType");
  const location = requireTrimmedString(infrastructure.location, "infrastructure.location");
  const adminCidr = requireTrimmedString(connection.adminCidr, "connection.adminCidr");
  const sshAuthorizedKeys = normalizeAuthorizedKeys(connection.sshAuthorizedKeys);
  if (sshAuthorizedKeys.length === 0) throw new Error("connection.sshAuthorizedKeys required");

  const image = parseOptionalString(infrastructure.image) ?? "";
  const sshExposureMode = normalizeExposureMode(connection.sshExposureMode);
  const volumeEnabled =
    typeof infrastructure.volumeEnabled === "boolean"
      ? infrastructure.volumeEnabled
      : undefined;
  const requestedVolumeSizeGb =
    typeof infrastructure.volumeSizeGb === "number" && Number.isFinite(infrastructure.volumeSizeGb)
      ? Math.max(0, Math.trunc(infrastructure.volumeSizeGb))
      : undefined;
  const resolvedVolumeSizeGb =
    volumeEnabled === false
      ? 0
      : volumeEnabled === true
        ? requestedVolumeSizeGb && requestedVolumeSizeGb > 0
          ? requestedVolumeSizeGb
          : 50
        : requestedVolumeSizeGb;

  return [
    { path: `hosts.${hostName}.provisioning.provider`, value: "hetzner", del: false },
    { path: `hosts.${hostName}.hetzner.serverType`, value: serverType, del: false },
    { path: `hosts.${hostName}.hetzner.image`, value: image, del: false },
    { path: `hosts.${hostName}.hetzner.location`, value: location, del: false },
    {
      path: `hosts.${hostName}.hetzner.allowTailscaleUdpIngress`,
      valueJson: JSON.stringify(Boolean(infrastructure.allowTailscaleUdpIngress)),
      del: false,
    },
    ...(resolvedVolumeSizeGb === undefined
      ? []
      : [{
          path: `hosts.${hostName}.hetzner.volumeSizeGb`,
          valueJson: JSON.stringify(resolvedVolumeSizeGb),
          del: false,
        }]),
    ...(resolvedVolumeSizeGb === 0
      ? [{
          path: `hosts.${hostName}.hetzner.volumeLinuxDevice`,
          del: true,
        }]
      : []),
    { path: `hosts.${hostName}.provisioning.adminCidr`, value: adminCidr, del: false },
    { path: `hosts.${hostName}.sshExposure.mode`, value: sshExposureMode, del: false },
    {
      path: "fleet.sshAuthorizedKeys",
      valueJson: JSON.stringify(sshAuthorizedKeys),
      del: false,
    },
  ];
}

function normalizeConfigMutation(params: {
  raw: SetupApplyConfigMutation;
  index: number;
  hostName: string;
}): SetupApplyConfigMutation {
  const raw = params.raw;
  const index = params.index;
  const field = `configMutations[${index}]`;
  const path = requireTrimmedString(raw.path, `${field}.path`);
  const del = raw.del === true;
  const value = typeof raw.value === "string"
    ? (() => {
        if (raw.value.includes("\0") || raw.value.includes("\r") || raw.value.includes("\n")) {
          throw new Error(`${field}.value invalid`);
        }
        return raw.value;
      })()
    : undefined;
  const valueJson = parseOptionalString(raw.valueJson);
  const hasValue = typeof value === "string";
  const hasValueJson = typeof valueJson === "string";
  if (hasValue && hasValueJson) throw new Error(`${field} ambiguous value`);
  if (del && (hasValue || hasValueJson)) throw new Error(`${field} delete cannot include value`);
  if (!del && !hasValue && !hasValueJson) throw new Error(`${field} missing value`);
  if (valueJson) {
    try {
      JSON.parse(valueJson);
    } catch {
      throw new Error(`${field}.valueJson invalid JSON`);
    }
  }
  return validateSetupApplyConfigMutation({
    mutation: { path, value, valueJson, del },
    hostName: params.hostName,
    field,
  });
}

function normalizeDeployCreds(raw: Record<string, string>): Record<string, string> {
  const allowed = new Set<string>(DEPLOY_CREDS_KEYS);
  const out = createNullProtoRecord<string>();
  for (const [key, value] of Object.entries(raw ?? {})) {
    const normalizedKey = requireTrimmedString(key, "deployCreds key");
    if (!allowed.has(normalizedKey)) {
      throw new Error(`deployCreds key not allowlisted: ${normalizedKey}`);
    }
    out[normalizedKey] = typeof value === "string" ? value : String(value ?? "");
  }
  if (Object.keys(out).length === 0) {
    throw new Error("deployCreds has no recognized keys");
  }
  return out;
}

function normalizeBootstrapSecrets(raw: Record<string, string>): Record<string, string> {
  const out = createNullProtoRecord<string>();
  for (const [key, value] of Object.entries(raw ?? {})) {
    const normalizedKey = requireTrimmedString(key, "bootstrapSecrets key");
    assertSafeRecordKey({ key: normalizedKey, context: "setup bootstrapSecrets" });
    if (
      normalizedKey !== "adminPassword" &&
      normalizedKey !== "adminPasswordHash" &&
      normalizedKey !== "tailscaleAuthKey" &&
      normalizedKey !== "tailscale_auth_key"
    ) {
      void SecretNameSchema.parse(normalizedKey);
    }
    if (typeof value !== "string") throw new Error(`bootstrapSecrets.${normalizedKey} must be string`);
    out[normalizedKey] = value;
  }
  return out;
}

export function buildSetupApplyPlan(params: {
  hostName: string;
  draft: SetupDraftNonSecret;
  targetRunnerId: string;
}): SetupApplyPlan {
  const hostName = HostNameSchema.parse(params.hostName);
  const targetRunnerId = requireTrimmedString(params.targetRunnerId, "targetRunnerId");
  return {
    schemaVersion: 1,
    hostName,
    targetRunnerId,
    configMutations: normalizeConfigMutations({
      hostName,
      draft: params.draft,
    }),
  };
}

export function createSetupApplyExecutionInput(params: {
  hostName: string;
  configMutations: SetupApplyConfigMutation[];
  deployCreds: Record<string, string>;
  bootstrapSecrets: Record<string, string>;
}): SetupApplyExecutionInput {
  const hostName = HostNameSchema.parse(params.hostName);
  if (!Array.isArray(params.configMutations) || params.configMutations.length === 0) {
    throw new Error("configMutations required");
  }
  return {
    hostName,
    configMutations: params.configMutations.map((row, index) =>
      normalizeConfigMutation({ raw: row, index, hostName })),
    deployCreds: normalizeDeployCreds(params.deployCreds),
    bootstrapSecrets: normalizeBootstrapSecrets(params.bootstrapSecrets),
  };
}

export function parseSetupApplyPlan(rawJson: string): SetupApplyExecutionInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("setup apply plan is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("setup apply plan must be an object");
  }
  const row = parsed as Record<string, unknown>;
  return createSetupApplyExecutionInput({
    hostName: requireTrimmedString(row.hostName, "hostName"),
    configMutations: Array.isArray(row.configMutations)
      ? (row.configMutations as SetupApplyConfigMutation[])
      : [],
    deployCreds:
      row.deployCreds && typeof row.deployCreds === "object" && !Array.isArray(row.deployCreds)
        ? (row.deployCreds as Record<string, string>)
        : {},
    bootstrapSecrets:
      row.bootstrapSecrets && typeof row.bootstrapSecrets === "object" && !Array.isArray(row.bootstrapSecrets)
        ? (row.bootstrapSecrets as Record<string, string>)
        : {},
  });
}
