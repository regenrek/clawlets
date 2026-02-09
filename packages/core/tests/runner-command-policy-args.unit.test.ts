import { describe, expect, it } from "vitest";
import { __test_validateArgsForKind } from "../src/lib/runtime/runner-command-policy";

describe("runner command policy args parser", () => {
  it("rejects unknown flags", () => {
    const result = __test_validateArgsForKind({
      kind: "project_init",
      args: ["project", "init", "--dir", ".", "--host", "alpha", "--nope", "x"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown flag/i);
  });

  it("rejects duplicate flags", () => {
    const result = __test_validateArgsForKind({
      kind: "project_init",
      args: ["project", "init", "--dir", ".", "--host", "alpha", "--host", "beta"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicate flag/i);
  });

  it("rejects `--` token", () => {
    const result = __test_validateArgsForKind({
      kind: "project_init",
      args: ["project", "init", "--dir", ".", "--host", "alpha", "--"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/forbidden/i);
  });

  it("accepts valid --flag=value syntax", () => {
    const result = __test_validateArgsForKind({
      kind: "project_init",
      args: ["project", "init", "--dir=.", "--host=alpha", "--template=owner/repo"],
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects invalid boolean --flag=value syntax", () => {
    const result = __test_validateArgsForKind({
      kind: "custom",
      args: ["git", "status", "--json=true"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not take a value/i);
  });
});
