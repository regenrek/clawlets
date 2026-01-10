import { describe, it, expect } from "vitest";
import { upsertSopsCreationRule } from "../src/lib/sops-config";

describe("sops-config", () => {
  it("upserts a creation rule", () => {
    const existing = `
creation_rules:
  - path_regex: ^other\\.yaml$
    age: age1other
`;
    const out = upsertSopsCreationRule({
      existingYaml: existing,
      pathRegex: "^bots01\\.yaml$",
      ageRecipients: ["age1a", "age1b", "age1a"],
    });
    expect(out).toContain("path_regex: ^bots01\\.yaml$");
    expect(out).toContain("age: age1a, age1b");
    expect(out).toContain("path_regex: ^other\\.yaml$");
  });

  it("updates an existing rule", () => {
    const existing = `
creation_rules:
  - path_regex: ^bots01\\.yaml$
    age: age1old
`;
    const out = upsertSopsCreationRule({
      existingYaml: existing,
      pathRegex: "^bots01\\.yaml$",
      ageRecipients: ["age1new"],
    });
    expect(out).toContain("age: age1new");
    expect(out).not.toContain("age1old");
  });

  it("requires recipients", () => {
    expect(() =>
      upsertSopsCreationRule({
        existingYaml: "",
        pathRegex: "^bots01\\.yaml$",
        ageRecipients: [],
      }),
    ).toThrow(/no age recipients/);
  });
});
