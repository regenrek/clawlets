import { isPlainObject } from "../../env-vars.js";
import { addChannelTokenRequirement } from "./common.js";
import type { SecretsCollectorContext } from "../types.js";

export function collectTelegramChannelRequirements(context: SecretsCollectorContext): void {
  if (!isPlainObject(context.openclaw)) return;
  const channels = context.openclaw.channels;
  if (!isPlainObject(channels)) return;

  const telegram = channels.telegram;
  if (!isPlainObject(telegram) || telegram.enabled === false) return;

  addChannelTokenRequirement({
    channel: "telegram",
    gatewayId: context.gatewayId,
    envVar: "TELEGRAM_BOT_TOKEN",
    path: "channels.telegram.botToken",
    value: telegram.botToken,
    warnings: context.warnings,
    addRequiredEnv: context.addRequiredEnv,
  });

  const accounts = telegram.accounts;
  if (!isPlainObject(accounts)) return;
  for (const [accountId, accountCfg] of Object.entries(accounts)) {
    if (!isPlainObject(accountCfg)) continue;
    addChannelTokenRequirement({
      channel: "telegram",
      gatewayId: context.gatewayId,
      envVar: "TELEGRAM_BOT_TOKEN",
      path: `channels.telegram.accounts.${accountId}.botToken`,
      value: accountCfg.botToken,
      warnings: context.warnings,
      addRequiredEnv: context.addRequiredEnv,
    });
  }
}
