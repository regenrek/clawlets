import { isPlainObject } from "../../env-vars.js";
import { addChannelTokenRequirement } from "./common.js";
import type { SecretsCollectorContext } from "../types.js";

export function collectSlackChannelRequirements(context: SecretsCollectorContext): void {
  if (!isPlainObject(context.openclaw)) return;
  const channels = context.openclaw.channels;
  if (!isPlainObject(channels)) return;

  const slack = channels.slack;
  if (!isPlainObject(slack) || slack.enabled === false) return;

  addChannelTokenRequirement({
    channel: "slack",
    gatewayId: context.gatewayId,
    envVar: "SLACK_BOT_TOKEN",
    path: "channels.slack.botToken",
    value: slack.botToken,
    warnings: context.warnings,
    addRequiredEnv: context.addRequiredEnv,
  });
  addChannelTokenRequirement({
    channel: "slack",
    gatewayId: context.gatewayId,
    envVar: "SLACK_APP_TOKEN",
    path: "channels.slack.appToken",
    value: slack.appToken,
    warnings: context.warnings,
    addRequiredEnv: context.addRequiredEnv,
  });

  const accounts = slack.accounts;
  if (!isPlainObject(accounts)) return;
  for (const [accountId, accountCfg] of Object.entries(accounts)) {
    if (!isPlainObject(accountCfg)) continue;
    addChannelTokenRequirement({
      channel: "slack",
      gatewayId: context.gatewayId,
      envVar: "SLACK_BOT_TOKEN",
      path: `channels.slack.accounts.${accountId}.botToken`,
      value: accountCfg.botToken,
      warnings: context.warnings,
      addRequiredEnv: context.addRequiredEnv,
    });
    addChannelTokenRequirement({
      channel: "slack",
      gatewayId: context.gatewayId,
      envVar: "SLACK_APP_TOKEN",
      path: `channels.slack.accounts.${accountId}.appToken`,
      value: accountCfg.appToken,
      warnings: context.warnings,
      addRequiredEnv: context.addRequiredEnv,
    });
  }
}
