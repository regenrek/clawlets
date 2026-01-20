import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("prepare-package guardrails", () => {
  it("rejects unsafe out dir without override", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
    const script = path.join(repoRoot, "scripts", "prepare-package.mjs");
    const tmpOut = path.join(os.tmpdir(), "clawdlets-unsafe-out");
    const res = spawnSync(process.execPath, [script, "--out", tmpOut, "--pkg", "packages/cli"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/--out must be under/i);
  });
});
