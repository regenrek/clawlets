import YAML from "yaml";

export type SopsCreationRule = {
  path_regex: string;
  age: string;
};

export type SopsConfig = {
  creation_rules?: SopsCreationRule[];
};

function normalizeRecipients(recipients: string[]): string[] {
  return Array.from(new Set(recipients.map((r) => r.trim()).filter(Boolean)));
}

export function upsertSopsCreationRule(params: {
  existingYaml?: string;
  pathRegex: string;
  ageRecipients: string[];
}): string {
  const recipients = normalizeRecipients(params.ageRecipients);
  if (recipients.length === 0) throw new Error("no age recipients provided");

  const cfg: SopsConfig = params.existingYaml
    ? (YAML.parse(params.existingYaml) as SopsConfig)
    : {};

  const rules = Array.isArray(cfg.creation_rules) ? cfg.creation_rules : [];
  const rule: SopsCreationRule = {
    path_regex: params.pathRegex,
    age: recipients.join(", "),
  };

  const idx = rules.findIndex((r) => r?.path_regex === params.pathRegex);
  const nextRules = [...rules];
  if (idx >= 0) nextRules[idx] = rule;
  else nextRules.push(rule);

  const next: SopsConfig = { ...cfg, creation_rules: nextRules };
  return YAML.stringify(next);
}

