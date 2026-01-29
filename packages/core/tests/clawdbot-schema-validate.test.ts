import { describe, expect, it } from "vitest";
import { validateClawdbotConfig } from "../src/lib/clawdbot-schema-validate.js";

describe("clawdbot schema validation issues", () => {
  it("points required property path", () => {
    const schema = { type: "object", required: ["name"] };
    const res = validateClawdbotConfig({}, schema);
    expect(res.ok).toBe(false);
    expect(res.issues[0]?.path).toEqual(["name"]);
  });

  it("points additionalProperties path", () => {
    const schema = {
      type: "object",
      properties: { ok: { type: "string" } },
      additionalProperties: false,
    };
    const res = validateClawdbotConfig({ ok: "x", extra: 1 }, schema);
    expect(res.ok).toBe(false);
    const paths = res.issues.map((i) => i.path.join("."));
    expect(paths).toContain("extra");
  });

  it("points propertyNames path", () => {
    const schema = { type: "object", propertyNames: { pattern: "^ok" } };
    const res = validateClawdbotConfig({ bad: 1 }, schema);
    expect(res.ok).toBe(false);
    const paths = res.issues.map((i) => i.path.join("."));
    expect(paths).toContain("bad");
  });

  it("captures array indices and JSON pointer decode", () => {
    const schema = {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "number" } },
        "a/b": { type: "string" },
      },
      additionalProperties: false,
    };
    const res = validateClawdbotConfig({ items: ["x"], "a/b": 1 }, schema);
    expect(res.ok).toBe(false);
    const paths = res.issues.map((i) => i.path.join("."));
    expect(paths.some((p) => p === "items.0")).toBe(true);
    expect(paths.some((p) => p === "a/b")).toBe(true);
  });
});
