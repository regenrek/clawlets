import { isPlainObject } from "../../env-vars.js";
import { addChannelTokenRequirement } from "./common.js";
import type { SecretsCollectorContext } from "../types.js";

export function collectDiscordChannelRequirements(context: SecretsCollectorContext): void {
  if (!isPlainObject(context.openclaw)) return;
  const channels = context.openclaw.channels;
  if (!isPlainObject(channels)) return;

  const discord = channels.discord;
  if (!isPlainObject(discord) || discord.enabled === false) return;

  addChannelTokenRequirement({
    channel: "discord",
    gatewayId: context.gatewayId,
    envVar: "DISCORD_BOT_TOKEN",
    path: "channels.discord.token",
    value: discord.token,
    warnings: context.warnings,
    addRequiredEnv: context.addRequiredEnv,
  });

  const accounts = discord.accounts;
  if (!isPlainObject(accounts)) return;
  for (const [accountId, accountCfg] of Object.entries(accounts)) {
    if (!isPlainObject(accountCfg)) continue;
    addChannelTokenRequirement({
      channel: "discord",
      gatewayId: context.gatewayId,
      envVar: "DISCORD_BOT_TOKEN",
      path: `channels.discord.accounts.${accountId}.token`,
      value: accountCfg.token,
      warnings: context.warnings,
      addRequiredEnv: context.addRequiredEnv,
    });
  }
}
