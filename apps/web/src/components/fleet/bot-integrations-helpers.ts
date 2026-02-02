export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function parseTextList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function getEnvMapping(params: {
  envVar: string
  fleetSecretEnv: unknown
  botSecretEnv: unknown
}): { secretName: string; scope: "bot" | "fleet" } | null {
  const envVar = params.envVar
  if (isPlainObject(params.botSecretEnv)) {
    const v = params.botSecretEnv[envVar]
    if (typeof v === "string" && v.trim()) return { secretName: v.trim(), scope: "bot" }
  }
  if (isPlainObject(params.fleetSecretEnv)) {
    const v = params.fleetSecretEnv[envVar]
    if (typeof v === "string" && v.trim()) return { secretName: v.trim(), scope: "fleet" }
  }
  return null
}

export function readInlineSecretWarnings(clawdbot: unknown): string[] {
  const warnings: string[] = []
  const cfg = isPlainObject(clawdbot) ? (clawdbot as Record<string, unknown>) : {}

  const channels = cfg["channels"]
  if (isPlainObject(channels)) {
    const discord = channels["discord"]
    const discordToken = isPlainObject(discord) ? discord["token"] : undefined
    if (typeof discordToken === "string" && discordToken.trim() && !discordToken.includes("${")) {
      warnings.push("Discord token looks inline (avoid secrets in config; use ${DISCORD_BOT_TOKEN}).")
    }

    const telegram = channels["telegram"]
    const telegramToken = isPlainObject(telegram) ? telegram["botToken"] : undefined
    if (typeof telegramToken === "string" && telegramToken.trim() && !telegramToken.includes("${")) {
      warnings.push("Telegram botToken looks inline (avoid secrets in config; use ${TELEGRAM_BOT_TOKEN}).")
    }

    const slack = channels["slack"]
    const slackBotToken = isPlainObject(slack) ? slack["botToken"] : undefined
    if (typeof slackBotToken === "string" && slackBotToken.trim() && !slackBotToken.includes("${")) {
      warnings.push("Slack botToken looks inline (avoid secrets in config; use ${SLACK_BOT_TOKEN}).")
    }
    const slackAppToken = isPlainObject(slack) ? slack["appToken"] : undefined
    if (typeof slackAppToken === "string" && slackAppToken.trim() && !slackAppToken.includes("${")) {
      warnings.push("Slack appToken looks inline (avoid secrets in config; use ${SLACK_APP_TOKEN}).")
    }
  }

  const hooks = cfg["hooks"]
  if (isPlainObject(hooks)) {
    const hooksToken = hooks["token"]
    if (typeof hooksToken === "string" && hooksToken.trim() && !hooksToken.includes("${")) {
      warnings.push("Hooks token looks inline (avoid secrets in config; use ${CLAWDBOT_HOOKS_TOKEN}).")
    }
    const gmail = hooks["gmail"]
    const gmailPushToken = isPlainObject(gmail) ? gmail["pushToken"] : undefined
    if (typeof gmailPushToken === "string" && gmailPushToken.trim() && !gmailPushToken.includes("${")) {
      warnings.push("Hooks Gmail pushToken looks inline (avoid secrets in config; use ${CLAWDBOT_HOOKS_GMAIL_PUSH_TOKEN}).")
    }
  }

  const skills = cfg["skills"]
  const entries = isPlainObject(skills) ? skills["entries"] : undefined
  if (isPlainObject(entries)) {
    for (const [skill, entry] of Object.entries(entries)) {
      if (!isPlainObject(entry)) continue
      const apiKey = entry["apiKey"]
      const apiKeySecret = entry["apiKeySecret"]
      const hasSecret = typeof apiKeySecret === "string" && Boolean(apiKeySecret.trim())
      if (typeof apiKey === "string" && apiKey.trim() && !apiKey.includes("${") && !hasSecret) {
        warnings.push(`Skill ${skill} apiKey looks inline (avoid secrets in config; use apiKeySecret).`)
      }
    }
  }

  return warnings
}

export function listEnabledChannels(clawdbot: unknown): string[] {
  const cfg = isPlainObject(clawdbot) ? (clawdbot as Record<string, unknown>) : {}
  const channels = cfg["channels"]
  if (!isPlainObject(channels)) return []
  return Object.keys(channels)
    .filter((k) => {
      const entry = channels[k]
      if (!isPlainObject(entry)) return true
      return entry["enabled"] !== false
    })
    .sort()
}
