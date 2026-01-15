import { describe, it, expect } from "vitest";
import path from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { normalizeTemplatePath, normalizeTemplateRef, normalizeTemplateRepo } from "../src/lib/template-source";
import { resolveTemplateTestDir } from "../src/lib/template-test-dir";

describe("template source validation", () => {
  it("accepts owner/repo format", () => {
    expect(normalizeTemplateRepo("owner/repo")).toBe("owner/repo");
    expect(normalizeTemplateRepo("owner-name/repo_name")).toBe("owner-name/repo_name");
  });

  it("rejects invalid repo format", () => {
    expect(() => normalizeTemplateRepo("owner")).toThrow(/owner\/repo/);
    expect(() => normalizeTemplateRepo("owner/repo/extra")).toThrow(/owner\/repo/);
    expect(() => normalizeTemplateRepo("owner repo")).toThrow(/owner\/repo/);
  });

  it("rejects path traversal", () => {
    expect(() => normalizeTemplatePath("../templates/default")).toThrow(/invalid segment/);
    expect(() => normalizeTemplatePath("templates/../default")).toThrow(/invalid segment/);
    expect(() => normalizeTemplatePath("/templates/default")).toThrow(/relative/);
  });

  it("validates ref format", () => {
    expect(normalizeTemplateRef("0123456789abcdef0123456789abcdef01234567")).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(() => normalizeTemplateRef("")).toThrow(/missing/);
    expect(() => normalizeTemplateRef("main")).toThrow(/40-hex/);
    expect(() => normalizeTemplateRef("bad^ref")).toThrow(/40-hex/);
  });
});

describe("template test dir guard", () => {
  it("rejects dangerous overrides", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-repo-"));
    await mkdir(path.join(repoRoot, "packages", "core", "tests"), { recursive: true });

    expect(() => resolveTemplateTestDir({ repoRoot, destRoot: "/" })).toThrow(/filesystem root/);
    expect(() => resolveTemplateTestDir({ repoRoot, destRoot: repoRoot })).toThrow(/repo root/);
    expect(() => resolveTemplateTestDir({ repoRoot, destRoot: path.join(repoRoot, "packages") })).toThrow(/end with/);
  });
});
