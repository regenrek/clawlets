import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRunnerJobCommand, validateRunnerJobPayload } from "../src/lib/runtime/runner-command-policy";

describe("runner command policy", () => {
  it("rejects non-allowlisted custom commands", () => {
    const result = validateRunnerJobPayload({
      kind: "custom",
      payloadMeta: {
        args: ["echo", "ok"],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/allowlisted/i);
  });

  it("rejects plugin custom commands", () => {
    const result = validateRunnerJobPayload({
      kind: "custom",
      payloadMeta: {
        args: ["plugin", "list"],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/forbidden/i);
  });

  it("enforces empty repoRoot for project_init", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-policy-init-"));
    try {
      await fs.writeFile(path.join(dir, "already-there.txt"), "x", "utf8");
      const result = await resolveRunnerJobCommand({
        kind: "project_init",
        payloadMeta: { hostName: "alpha" },
        repoRoot: dir,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/must be empty/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("enforces empty repoRoot for project_import", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-policy-import-root-"));
    try {
      await fs.writeFile(path.join(dir, "already-there.txt"), "x", "utf8");
      const result = await resolveRunnerJobCommand({
        kind: "project_import",
        payloadMeta: { repoUrl: "https://github.com/regenrek/clawlets.git" },
        repoRoot: dir,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/must be empty/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("builds canonical project_import command", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-policy-import-"));
    try {
      const result = await resolveRunnerJobCommand({
        kind: "project_import",
        payloadMeta: {
          repoUrl: "git@github.com:regenrek/clawlets.git",
          branch: "main",
          depth: 1,
        },
        repoRoot: dir,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.exec).toBe("git");
      expect(result.args).toEqual([
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "--branch",
        "main",
        "git@github.com:regenrek/clawlets.git",
        ".",
      ]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("defaults project_import depth to 1 and keeps single-branch", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-policy-import-default-depth-"));
    try {
      const result = await resolveRunnerJobCommand({
        kind: "project_import",
        payloadMeta: { repoUrl: "https://github.com/regenrek/clawlets.git" },
        repoRoot: dir,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.exec).toBe("git");
      expect(result.args).toEqual([
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "https://github.com/regenrek/clawlets.git",
        ".",
      ]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects project_import insecure protocols", () => {
    for (const repoUrl of ["http://github.com/regenrek/clawlets.git", "git://github.com/regenrek/clawlets.git"]) {
      const result = validateRunnerJobPayload({
        kind: "project_import",
        payloadMeta: { repoUrl },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/invalid protocol/i);
    }
  });

  it("rejects project_import loopback and link-local hosts", () => {
    for (const repoUrl of [
      "https://localhost/regenrek/clawlets.git",
      "ssh://[::1]/regenrek/clawlets.git",
      "git@[::1]:regenrek/clawlets.git",
      "https://169.254.169.254/regenrek/clawlets.git",
    ]) {
      const result = validateRunnerJobPayload({
        kind: "project_import",
        payloadMeta: { repoUrl },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/host is not allowed/i);
    }
  });

  it("rejects local template inputs for project_init", () => {
    const result = validateRunnerJobPayload({
      kind: "project_init",
      payloadMeta: {
        hostName: "alpha",
        templateRepo: "file:/tmp/template",
      },
    });
    expect(result.ok).toBe(false);
  });
});
