import { describe, expect, it } from "vitest";
import { RUNNER_DEPLOY_CREDS_SUMMARY_SCHEMA_VERSION } from "@clawlets/core/lib/runtime/runner-deploy-creds-contract";
import { sanitizeDeployCredsSummary } from "../convex/controlPlane/httpParsers";

describe("runner deploy-creds summary sanitization", () => {
  it("returns null for invalid root payloads", () => {
    expect(sanitizeDeployCredsSummary(null)).toBeNull();
    expect(sanitizeDeployCredsSummary([])).toBeNull();
    expect(sanitizeDeployCredsSummary({ updatedAtMs: "nope" })).toBeNull();
  });

  it("normalizes defaults and clamps keyring counts", () => {
    const out = sanitizeDeployCredsSummary({
      updatedAtMs: 1234.9,
      envFileOrigin: "other",
      envFileStatus: "other",
      envFileError: "env read failed",
      hasGithubToken: 1,
      sopsAgeKeyFileSet: "",
      projectTokenKeyrings: {
        hcloud: { hasActive: "yes", itemCount: 20_000 },
      },
    });
    expect(out).toEqual({
      schemaVersion: RUNNER_DEPLOY_CREDS_SUMMARY_SCHEMA_VERSION,
      updatedAtMs: 1234,
      envFileOrigin: "default",
      envFileStatus: "missing",
      envFileError: "env read failed",
      hasGithubToken: true,
      hasGithubTokenAccess: true,
      hasGitRemoteOrigin: false,
      sopsAgeKeyFileSet: false,
      projectTokenKeyrings: {
        hcloud: { hasActive: true, itemCount: 10_000, items: [] },
      },
      fleetSshAuthorizedKeys: { count: 0, items: [] },
      fleetSshKnownHosts: { count: 0, items: [] },
    });
  });

  it("drops legacy project-level tailscale keyring entries", () => {
    const out = sanitizeDeployCredsSummary({
      updatedAtMs: 1234,
      hasGithubToken: false,
      sopsAgeKeyFileSet: false,
      projectTokenKeyrings: {
        hcloud: { hasActive: false, itemCount: 0, items: [] },
        tailscale: {
          hasActive: true,
          itemCount: 2,
          items: [{ id: "1", label: "ts", maskedValue: "***", isActive: true }],
        },
      },
    });
    expect(out).not.toBeNull();
    expect(out?.schemaVersion).toBe(RUNNER_DEPLOY_CREDS_SUMMARY_SCHEMA_VERSION);
    expect(out?.projectTokenKeyrings).toEqual({
      hcloud: { hasActive: false, itemCount: 0, items: [] },
    });
  });

  it("accepts valid typed payloads without mutation", () => {
    const input = {
      schemaVersion: RUNNER_DEPLOY_CREDS_SUMMARY_SCHEMA_VERSION,
      updatedAtMs: 9_999,
      envFileOrigin: "explicit",
      envFileStatus: "ok",
      hasGithubToken: true,
      hasGithubTokenAccess: true,
      hasGitRemoteOrigin: false,
      sopsAgeKeyFileSet: true,
      projectTokenKeyrings: {
        hcloud: { hasActive: true, itemCount: 2, items: [] },
      },
      fleetSshAuthorizedKeys: { count: 0, items: [] },
      fleetSshKnownHosts: { count: 0, items: [] },
    };
    expect(sanitizeDeployCredsSummary(input)).toEqual(input);
  });
});
