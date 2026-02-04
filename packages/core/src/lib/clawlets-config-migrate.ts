import { CLAWLETS_CONFIG_SCHEMA_VERSION } from "./clawlets-config.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type MigrateToLatestResult = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: Record<string, unknown>;
};

export function migrateClawletsConfigToLatest(raw: unknown): MigrateToLatestResult {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  const next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw new Error(`invalid schemaVersion: ${schemaVersion} (expected ${CLAWLETS_CONFIG_SCHEMA_VERSION})`);
  }

  if (schemaVersion === CLAWLETS_CONFIG_SCHEMA_VERSION) {
    return { ok: true, changed: false, warnings, migrated: next };
  }

  // Pre-release bridge: v18 was never shipped; allow local dev repos to normalize to v1.
  if (schemaVersion === 18 && CLAWLETS_CONFIG_SCHEMA_VERSION === 1) {
    next["schemaVersion"] = 1;
    warnings.push("normalized schemaVersion 18 -> 1 (no shape changes)");
    return { ok: true, changed: true, warnings, migrated: next };
  }

  throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected ${CLAWLETS_CONFIG_SCHEMA_VERSION})`);
}

