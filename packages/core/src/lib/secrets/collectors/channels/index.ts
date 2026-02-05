import type { SecretsCollectorContext } from "../types.js";
import { collectDiscordChannelRequirements } from "./discord.js";
import { collectTelegramChannelRequirements } from "./telegram.js";
import { collectSlackChannelRequirements } from "./slack.js";

export function collectChannelSecretRequirements(context: SecretsCollectorContext): void {
  collectDiscordChannelRequirements(context);
  collectTelegramChannelRequirements(context);
  collectSlackChannelRequirements(context);
}
