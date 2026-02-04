const ENV_VAR_SECRET_NAME_SUGGESTIONS: Record<string, (gatewayId?: string) => string> = {
  DISCORD_BOT_TOKEN: (gatewayId) => `discord_token_${gatewayId || "gateway"}`,
  TELEGRAM_BOT_TOKEN: (gatewayId) => `telegram_bot_token_${gatewayId || "gateway"}`,
  SLACK_BOT_TOKEN: (gatewayId) => `slack_bot_token_${gatewayId || "gateway"}`,
  SLACK_APP_TOKEN: (gatewayId) => `slack_app_token_${gatewayId || "gateway"}`,
}

export function suggestSecretNameForEnvVar(envVar: string, gatewayId?: string): string {
  const key = String(envVar || "").trim()
  if (!key) return ""
  const direct = ENV_VAR_SECRET_NAME_SUGGESTIONS[key]
  if (direct) return direct(gatewayId)
  return key.toLowerCase()
}
