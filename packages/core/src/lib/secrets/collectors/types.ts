import type { SecretSource, SecretsPlanWarning } from "../secrets-plan.js";

export type AddRequiredEnv = (envVar: string, source: SecretSource, path?: string) => void;

export type SecretsCollectorContext = {
  gatewayId: string;
  hostName: string;
  openclaw: unknown;
  warnings: SecretsPlanWarning[];
  addRequiredEnv: AddRequiredEnv;
  envVarHelpOverrides: Map<string, string>;
  models: string[];
  secretEnv: Record<string, string>;
  aliasMap: Map<string, string>;
};

export type SecretsCollectorId = "channels" | "hooks" | "skills" | "providers";

export type SecretsCollector = {
  id: SecretsCollectorId;
  order: number;
  collect(context: SecretsCollectorContext): void;
};
