import type { DeployCredsKey } from "../infra/deploy-creds.js";

export const SETUP_APPLY_PLAN_SCHEMA_VERSION = 1 as const;
export const SETUP_APPLY_HOSTNAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const SETUP_APPLY_SAFE_STRING_KEY_RE = /^[A-Za-z0-9._-]+$/;

export const SETUP_APPLY_ALLOWED_CONFIG_PATH_SUFFIXES = new Set<string>([
  "provisioning.provider",
  "hetzner.serverType",
  "hetzner.image",
  "hetzner.location",
  "hetzner.allowTailscaleUdpIngress",
  "hetzner.volumeSizeGb",
  "hetzner.volumeLinuxDevice",
  "provisioning.adminCidr",
  "sshExposure.mode",
]);

export const SETUP_APPLY_ALLOWED_GLOBAL_CONFIG_PATHS = new Set<string>([
  "fleet.sshAuthorizedKeys",
]);

export const SETUP_APPLY_ALLOWED_BOOTSTRAP_SECRET_KEYS = new Set<string>([
  "adminPassword",
  "adminPasswordHash",
  "tailscaleAuthKey",
  "tailscale_auth_key",
]);

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

export type SetupApplyConfigMutation = {
  path: string;
  value?: string;
  valueJson?: string;
  del: boolean;
};

export type SetupApplyPlan = {
  schemaVersion: typeof SETUP_APPLY_PLAN_SCHEMA_VERSION;
  hostName: string;
  configMutations: SetupApplyConfigMutation[];
  deployCreds: Partial<Record<DeployCredsKey, string>>;
  bootstrapSecrets: Record<string, string>;
};

export type SetupApplyStepId =
  | "plan_validated"
  | "workspace_staged"
  | "config_written"
  | "deploy_creds_written"
  | "bootstrap_secrets_initialized"
  | "bootstrap_secrets_verified"
  | "persist_committed";

export type SetupApplyStepStatus = "pending" | "running" | "succeeded" | "failed";

export type SetupApplyStepResult = {
  stepId: SetupApplyStepId;
  status: SetupApplyStepStatus;
  safeMessage: string;
  detail?: Record<string, unknown>;
  retryable: boolean;
  updatedAtMs: number;
};

export type SetupApplyExecutionSummary = {
  hostName: string;
  configUpdatedPaths: string[];
  deployCredsUpdatedKeys: string[];
  verifiedSecrets: {
    ok: number;
    missing: number;
    warn: number;
    total: number;
  };
};

export type SetupApplyExecutionResult = {
  terminal: "succeeded" | "failed";
  steps: SetupApplyStepResult[];
  summary: SetupApplyExecutionSummary;
};

export function normalizeSetupApplyString(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${field} required`);
  if (normalized.includes("\0") || normalized.includes("\n") || normalized.includes("\r")) {
    throw new Error(`${field} invalid`);
  }
  return normalized;
}

export function ensureSetupApplyHostName(raw: unknown, field = "hostName"): string {
  const hostName = normalizeSetupApplyString(raw, field);
  if (!SETUP_APPLY_HOSTNAME_RE.test(hostName)) throw new Error(`${field} invalid`);
  return hostName;
}

export function buildSetupApplyEnvelopeAad(params: {
  projectId: string;
  operationId: string;
  targetRunnerId: string;
}): string {
  const projectId = normalizeSetupApplyString(params.projectId, "projectId");
  const operationId = normalizeSetupApplyString(params.operationId, "operationId");
  const targetRunnerId = normalizeSetupApplyString(params.targetRunnerId, "targetRunnerId");
  return `${projectId}:${operationId}:setupApply:${targetRunnerId}`;
}

export function normalizeSetupApplyStringMap(
  raw: unknown,
  field: string,
  allowedKeys?: ReadonlySet<string>,
): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${field} must be an object`);
  }
  const row = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const key = normalizeSetupApplyString(rawKey, `${field} key`);
    if (!SETUP_APPLY_SAFE_STRING_KEY_RE.test(key)) throw new Error(`${field}.${key} invalid key`);
    if (allowedKeys && !allowedKeys.has(key)) throw new Error(`${field}.${key} not allowlisted`);
    if (typeof rawValue !== "string") throw new Error(`${field}.${key} must be string`);
    out[key] = rawValue;
  }
  return out;
}

export function validateSetupApplyConfigMutation(params: {
  mutation: SetupApplyConfigMutation;
  hostName: string;
  field?: string;
}): SetupApplyConfigMutation {
  const field = params.field || "configMutations[]";
  const mutation = params.mutation;
  const path = normalizeSetupApplyString(mutation.path, `${field}.path`);
  const hostPrefix = `hosts.${params.hostName}.`;
  const allowedHostPath = path.startsWith(hostPrefix)
    && SETUP_APPLY_ALLOWED_CONFIG_PATH_SUFFIXES.has(path.slice(hostPrefix.length));
  const allowedGlobalPath = SETUP_APPLY_ALLOWED_GLOBAL_CONFIG_PATHS.has(path);
  if (!allowedHostPath && !allowedGlobalPath) {
    throw new Error(`${field}.path not allowlisted`);
  }
  const hasValue = typeof mutation.value === "string";
  const hasValueJson = typeof mutation.valueJson === "string";
  if (hasValue && hasValueJson) throw new Error(`${field} ambiguous value`);
  if (mutation.del && (hasValue || hasValueJson)) throw new Error(`${field} delete cannot include value`);
  if (!mutation.del && !hasValue && !hasValueJson) throw new Error(`${field} missing value`);
  if (hasValue && String(mutation.value || "").includes("\0")) throw new Error(`${field}.value invalid`);
  if (hasValueJson) {
    const valueJson = String(mutation.valueJson || "");
    if (valueJson.includes("\0")) throw new Error(`${field}.valueJson invalid`);
    JSON.parse(valueJson);
  }
  return {
    path,
    value: hasValue ? String(mutation.value) : undefined,
    valueJson: hasValueJson ? String(mutation.valueJson) : undefined,
    del: mutation.del === true,
  };
}

export function createSetupApplyStepResult(params: {
  stepId: SetupApplyStepId;
  status: SetupApplyStepStatus;
  safeMessage: string;
  detail?: Record<string, unknown>;
  retryable?: boolean;
  updatedAtMs?: number;
}): SetupApplyStepResult {
  return {
    stepId: params.stepId,
    status: params.status,
    safeMessage: params.safeMessage,
    detail: params.detail,
    retryable: params.retryable ?? params.status === "failed",
    updatedAtMs: Math.trunc(params.updatedAtMs ?? Date.now()),
  };
}

export function buildSetupApplyTelemetryMessage(step: Pick<SetupApplyStepResult, "stepId" | "safeMessage">): string {
  return `[setup_apply:${step.stepId}] ${step.safeMessage}`;
}
