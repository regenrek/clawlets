import { describe, expect, it } from "vitest";

describe("clawlets config migrate", () => {
  it("is idempotent on schemaVersion v1", async () => {
    const { migrateClawletsConfigToLatest } = await import("../src/lib/clawlets-config-migrate");

    const raw = { schemaVersion: 1, hosts: {} };
    const res = migrateClawletsConfigToLatest(raw);

    expect(res.ok).toBe(true);
    expect(res.changed).toBe(false);
    expect(res.warnings).toEqual([]);
    expect(res.migrated).not.toBe(raw);
    expect(res.migrated.schemaVersion).toBe(1);
  });

  it("normalizes schemaVersion 18 -> 1", async () => {
    const { migrateClawletsConfigToLatest } = await import("../src/lib/clawlets-config-migrate");

    const raw = { schemaVersion: 18, hosts: {} };
    const res = migrateClawletsConfigToLatest(raw);

    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.warnings.some((w) => w.includes("18 -> 1"))).toBe(true);
    expect(res.migrated.schemaVersion).toBe(1);
  });

  it("rejects unsupported schema versions", async () => {
    const { migrateClawletsConfigToLatest } = await import("../src/lib/clawlets-config-migrate");
    expect(() => migrateClawletsConfigToLatest({ schemaVersion: 2 })).toThrow(/unsupported schemaVersion/i);
  });
});

