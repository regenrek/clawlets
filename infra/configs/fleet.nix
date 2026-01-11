{ lib }:
let
  cfg = builtins.fromJSON (builtins.readFile ./clawdlets.json);
  fleetCfg = cfg.fleet or { };

  zaiEnv = {
    ZAI_API_KEY = "z_ai_api_key";
    Z_AI_API_KEY = "z_ai_api_key";
  };

  baseGatewayPort = 18789;
  gatewayPortStride = 10;

  # Single source of truth for bot instances.
  bots = fleetCfg.bots or [ "maren" "sonja" "gunnar" "melinda" ];

  gatewayPorts = builtins.listToAttrs (lib.lists.imap0 (i: b: {
    name = b;
    value = baseGatewayPort + (i * gatewayPortStride);
  }) bots);

  baseBot = {
    envSecrets = zaiEnv;
    skills = {
      # Explicit allowlist required on servers. Avoid null (typically means “allow all bundled skills”).
      allowBundled = [ ];
      entries = { };
    };
    extraConfig = { };
  };

  mkBot = overrides: lib.recursiveUpdate baseBot overrides;

  botOverrides = fleetCfg.botOverrides or { };

  mkBotProfile = b: mkBot (lib.recursiveUpdate {
    extraConfig = {
      gateway.port = gatewayPorts.${b};
    };
  } (botOverrides.${b} or { }));

  defaultRouting = {
    channels = [ ];
    requireMention = true;
  };

  routingOverrides = fleetCfg.routingOverrides or { };
in {
  inherit bots;

  # set this to your Discord guild/server id
  guildId = fleetCfg.guildId or "";

  documentsDir = ./documents;
  identity = null;

  codex = {
    enable = (fleetCfg.codex or { }).enable or false;
    bots = (fleetCfg.codex or { }).bots or [ ];
  };

  botProfiles = lib.genAttrs bots mkBotProfile;

  backups = {
    restic = {
      enable = ((fleetCfg.backups or { }).restic or { }).enable or false;
      repository = ((fleetCfg.backups or { }).restic or { }).repository or "";
      passwordSecret = "restic_password";
      environmentSecret = null;
    };
  };

  routing = lib.recursiveUpdate
    (lib.genAttrs bots (_: defaultRouting))
    routingOverrides;
}
