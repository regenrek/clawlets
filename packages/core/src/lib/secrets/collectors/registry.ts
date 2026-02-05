import type { SecretsCollector, SecretsCollectorContext } from "./types.js";
import { collectChannelSecretRequirements } from "./channels/index.js";
import { collectHookSecretRequirements } from "./hooks.js";
import { collectSkillSecretRequirements } from "./skills.js";
import { collectProviderSecretRequirements } from "./providers.js";

export const SECRET_REQUIREMENT_COLLECTORS: ReadonlyArray<SecretsCollector> = [
  { id: "channels", order: 10, collect: collectChannelSecretRequirements },
  { id: "hooks", order: 20, collect: collectHookSecretRequirements },
  { id: "skills", order: 30, collect: collectSkillSecretRequirements },
  { id: "providers", order: 40, collect: collectProviderSecretRequirements },
] as const;

export function runSecretRequirementCollectors(context: SecretsCollectorContext): void {
  for (const collector of SECRET_REQUIREMENT_COLLECTORS) {
    collector.collect(context);
  }
}
