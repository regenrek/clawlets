function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assertSafeKey(key: string, path: string): void {
  if (POLLUTION_KEYS.has(key)) {
    const where = path ? `${path}.${key}` : key;
    throw new Error(`blocked prototype pollution key "${key}" at ${where}`);
  }
}

function copySafeRecord(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(obj)) {
    assertSafeKey(k, path);
    out[k] = v;
  }
  return out;
}

function readBotRoutingV6(v: unknown): { channels: string[]; requireMention: boolean } {
  const o = asRecord(v);
  const channels = asStringArray(o.channels);
  const requireMention = o.requireMention === false ? false : true;
  return { channels: Array.from(new Set(channels)), requireMention };
}

function recursiveMerge(base: any, override: any, path: string): any {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out = copySafeRecord(base, path);
  for (const [k, v] of Object.entries(override)) {
    assertSafeKey(k, path);
    const bv = (out as any)[k];
    if (isPlainObject(bv) && isPlainObject(v)) out[k] = recursiveMerge(bv, v, `${path}.${k}`);
    else out[k] = v;
  }
  return out;
}

export function migrateClawdletsConfigV6ToV7(raw: unknown): unknown {
  const root = asRecord(raw);
  const schemaVersion = (root as any).schemaVersion;
  if (schemaVersion !== 6) throw new Error(`expected schemaVersion=6, got: ${schemaVersion}`);

  const fleet6 = asRecord((root as any).fleet);
  const botOverrides6 = asRecord(fleet6.botOverrides);
  const routingOverrides6 = asRecord(fleet6.routingOverrides);
  const guildId = String(fleet6.guildId ?? "").trim();

  const botsFromList = asStringArray(fleet6.bots);
  const botsFromOverrides = Object.keys(botOverrides6).map((b) => String(b ?? "").trim()).filter(Boolean);
  const botOrder: string[] = [];
  const seen = new Set<string>();
  for (const b of botsFromList) {
    if (seen.has(b)) continue;
    botOrder.push(b);
    seen.add(b);
  }
  for (const b of botsFromOverrides.sort()) {
    if (seen.has(b)) continue;
    botOrder.push(b);
    seen.add(b);
  }

  const bots7: Record<string, unknown> = Object.create(null);
  for (const bot of botOrder) {
    assertSafeKey(bot, "fleet.botOverrides");
    const override = asRecord((botOverrides6 as any)[bot]);

    const passthrough = copySafeRecord(asRecord((override as any).passthrough), `fleet.botOverrides.${bot}.passthrough`);
    const profile: Record<string, unknown> = copySafeRecord(override, `fleet.botOverrides.${bot}`);
    delete (profile as any).passthrough;

    const routing = readBotRoutingV6((routingOverrides6 as any)[bot]);
    if (guildId) assertSafeKey(guildId, "fleet.guildId");
    const safeChannels = routing.channels.map((ch) => {
      assertSafeKey(ch, `fleet.routingOverrides.${bot}.channels`);
      return ch;
    });
    const derivedDiscord =
      guildId && safeChannels.length > 0
        ? {
            channels: {
              discord: {
                enabled: true,
                token: "${DISCORD_BOT_TOKEN}",
                guilds: {
                  [guildId]: {
                    requireMention: routing.requireMention,
                    channels: Object.fromEntries(
                      safeChannels.map((ch) => [ch, { allow: true, requireMention: routing.requireMention }]),
                    ),
                  },
                },
              },
            },
          }
        : {};

    const clawdbot = recursiveMerge(derivedDiscord, passthrough, "fleet.bots.<bot>.clawdbot");

    bots7[bot] = {
      ...(Object.keys(profile).length > 0 ? { profile } : {}),
      ...(Object.keys(clawdbot).length > 0 ? { clawdbot } : {}),
    };
  }

  const fleet7 = {
    envSecrets: asRecord(fleet6.envSecrets),
    botOrder,
    bots: bots7,
    codex: asRecord(fleet6.codex),
    backups: asRecord(fleet6.backups),
  };

  return {
    ...root,
    schemaVersion: 7,
    fleet: fleet7,
  };
}
