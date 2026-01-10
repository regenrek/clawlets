import { describe, it, expect } from "vitest";
import { redactDotenv, upsertDotenv } from "../src/lib/dotenv-file";

describe("dotenv-file", () => {
  it("upserts existing keys and appends missing keys", () => {
    const input = ["FOO=bar", "BAZ=1", ""].join("\n");
    const out = upsertDotenv(input, {
      FOO: "next",
      NEW: "hello world",
    });
    expect(out).toContain("FOO=next\n");
    expect(out).toContain('NEW="hello world"\n');
    expect(out.endsWith("\n")).toBe(true);
  });

  it("does not add a leading newline for an empty file", () => {
    const out = upsertDotenv("", { A: "1" });
    expect(out).toBe("A=1\n");
  });

  it("redacts selected keys", () => {
    const input = ["HCLOUD_TOKEN=abc", 'GITHUB_TOKEN="def"', "OK=1", ""].join(
      "\n",
    );
    const out = redactDotenv(input, ["HCLOUD_TOKEN", "GITHUB_TOKEN"]);
    expect(out).toContain('HCLOUD_TOKEN="***REDACTED***"');
    expect(out).toContain('GITHUB_TOKEN="***REDACTED***"');
    expect(out).toContain("OK=1");
  });
});

