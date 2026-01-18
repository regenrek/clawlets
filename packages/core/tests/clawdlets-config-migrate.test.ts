import { describe, it, expect } from "vitest";

describe("clawdlets config migrate", () => {
  it("blocks prototype pollution in passthrough", async () => {
    const { migrateClawdletsConfigV6ToV7 } = await import("../src/lib/clawdlets-config-migrate");
    const raw = JSON.parse(
      '{"schemaVersion":6,"fleet":{"bots":["maren"],"botOverrides":{"maren":{"passthrough":{"__proto__":{"polluted":true}}}},"routingOverrides":{}}}',
    );

    expect(() => migrateClawdletsConfigV6ToV7(raw)).toThrow(/prototype pollution/i);
    expect(({} as any).polluted).toBeUndefined();
  });

  it("derives discord config from routingOverrides + guildId", async () => {
    const { migrateClawdletsConfigV6ToV7 } = await import("../src/lib/clawdlets-config-migrate");
    const raw = {
      schemaVersion: 6,
      fleet: {
        bots: ["maren"],
        botOverrides: { maren: { passthrough: {} } },
        routingOverrides: { maren: { channels: ["alpha", "beta"], requireMention: false } },
        guildId: "guild-1",
      },
    };

    const migrated = migrateClawdletsConfigV6ToV7(raw) as any;
    const discord = migrated.fleet.bots.maren.clawdbot.channels.discord;
    expect(discord.enabled).toBe(true);
    expect(discord.token).toBe("${DISCORD_BOT_TOKEN}");
    expect(discord.guilds["guild-1"].requireMention).toBe(false);
    expect(Object.keys(discord.guilds["guild-1"].channels)).toEqual(["alpha", "beta"]);
  });

  it("builds botOrder from bots list and overrides", async () => {
    const { migrateClawdletsConfigV6ToV7 } = await import("../src/lib/clawdlets-config-migrate");
    const raw = {
      schemaVersion: 6,
      fleet: {
        bots: ["beta", "alpha", "beta"],
        botOverrides: { gamma: {}, alpha: {} },
        routingOverrides: {},
      },
    };

    const migrated = migrateClawdletsConfigV6ToV7(raw) as any;
    expect(migrated.fleet.botOrder).toEqual(["beta", "alpha", "gamma"]);
  });
});
