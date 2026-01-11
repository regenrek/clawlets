{ config, lib, pkgs, defs, botConfig }:

let
  inherit (defs)
    cfg
    getBotProfile
    resolveBotWorkspace
    resolveBotCredsDir
    mkSopsSecretFor;

  inherit (botConfig) mkBotConfig;

  mkBotSecret = b: {
    "discord_token_${b}" = {
      inherit (mkSopsSecretFor "discord_token_${b}") owner group mode sopsFile;
    };
  };

  mkBotSkillSecrets = b:
    let
      profile = getBotProfile b;
      entries = profile.skills.entries or {};
      botEnvSecrets = builtins.attrValues (profile.envSecrets or {});
      hooksSecrets =
        (lib.optional ((profile.hooks.tokenSecret or null) != null) profile.hooks.tokenSecret)
        ++ (lib.optional ((profile.hooks.gmailPushTokenSecret or null) != null) profile.hooks.gmailPushTokenSecret);
      githubSecrets =
        lib.optional ((profile.github.privateKeySecret or null) != null) profile.github.privateKeySecret;
      perEntrySecrets = lib.concatLists (lib.mapAttrsToList (_: entry:
        (lib.optional ((entry.apiKeySecret or null) != null) entry.apiKeySecret)
        ++ (builtins.attrValues (entry.envSecrets or {}))
      ) entries);
      allSecrets = lib.unique (lib.filter (s: s != null && s != "") (hooksSecrets ++ githubSecrets ++ perEntrySecrets ++ botEnvSecrets));
    in
      builtins.listToAttrs (map (secretName: { name = secretName; value = mkSopsSecretFor secretName; }) allSecrets);

  mkTemplate = b:
    {
      "clawdbot-${b}.json" = {
        owner = "bot-${b}";
        group = "bot-${b}";
        mode = "0400";
        # Important: keep template content pure at eval time.
        # `builtins.readFile (pkgs.formats.json.generate ...)` forces a local build/eval-store write,
        # which breaks remote-build workflows on hosts that reject unsigned local store paths.
        content = builtins.toJSON (mkBotConfig b);
      };
    };

  mkEnvTemplate = b:
    let
      profile = getBotProfile b;
      envSecrets = profile.envSecrets or {};
      secretEnv = builtins.mapAttrs (_: secretName: config.sops.placeholder.${secretName}) envSecrets;
      lines = lib.concatStringsSep "\n" (lib.mapAttrsToList (k: v: "${k}=${v}") secretEnv);
    in
      lib.optionalAttrs (secretEnv != {}) {
        "clawdbot-${b}.env" = {
          owner = "bot-${b}";
          group = "bot-${b}";
          mode = "0400";
          content = lines + "\n";
        };
      };

  mkBotUser = b: {
    name = "bot-${b}";
    value =
      let
        stateDir = "${cfg.stateDirBase}/${b}";
      in {
        isSystemUser = true;
        group = "bot-${b}";
        home = stateDir;
        createHome = false;
        shell = pkgs.bashInteractive;
      };
  };

  mkBotGroup = b: { name = "bot-${b}"; value = {}; };

  mkStateDir = b:
    let
      dir = "${cfg.stateDirBase}/${b}";
      workspace = resolveBotWorkspace b;
      credsDir = resolveBotCredsDir b;
    in [
      "d ${dir} 0700 bot-${b} bot-${b} - -"
      "d ${workspace} 0700 bot-${b} bot-${b} - -"
      "d ${credsDir} 0700 bot-${b} bot-${b} - -"
    ];

  mkService = b:
    let
      stateDir = "${cfg.stateDirBase}/${b}";
      workspace = resolveBotWorkspace b;
      profile = getBotProfile b;
      cfgPath = "/run/secrets/rendered/clawdbot-${b}.json";
      clawPkg = cfg.package;
      seedDir = profile.workspace.seedDir or cfg.documentsDir or null;
      credsDir = resolveBotCredsDir b;
      env = profile.env or {};
      envSecrets = profile.envSecrets or {};
      envDupes = lib.intersectLists (builtins.attrNames env) (builtins.attrNames envSecrets);
      gh = profile.github or {};
      ghEnabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      ghEnvFile = "${credsDir}/gh.env";
      envSecretsFile =
        if envSecrets == {}
        then null
        else "/run/secrets/rendered/clawdbot-${b}.env";
      seedWorkspaceScript =
        if seedDir != null
        then pkgs.writeShellScript "clawdbot-seed-workspace-${b}" ''
          set -euo pipefail
          ws='${workspace}'
          if [ -z "$(ls -A "$ws" 2>/dev/null || true)" ]; then
            cp -a '${seedDir}/.' "$ws/"

            tools_md='/etc/clawdlets/tools.md'
            if [ -f "$ws/TOOLS.md" ] && [ -r "$tools_md" ]; then
              if ! grep -q 'clawdlets-tools:begin' "$ws/TOOLS.md"; then
                {
                  printf '\n<!-- clawdlets-tools:begin -->\n'
                  cat "$tools_md"
                  printf '\n<!-- clawdlets-tools:end -->\n'
                } >>"$ws/TOOLS.md"
              fi
            fi
          fi
        ''
        else null;
    in
      {
        name = "clawdbot-${b}";
        value = {
          description = "Clawdbot Discord gateway (${b})";
          wantedBy = [ "multi-user.target" ];
          after = [ "network-online.target" "sops-nix.service" ] ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service";
          wants = [ "network-online.target" "sops-nix.service" ] ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service";

          environment =
            if envDupes != []
            then throw "services.clawdbotFleet.botProfiles.${b}.envSecrets has duplicate env keys: ${lib.concatStringsSep "," envDupes}"
            else {
              CLAWDBOT_NIX_MODE = "1";
              CLAWDBOT_STATE_DIR = stateDir;
              CLAWDBOT_CONFIG_PATH = cfgPath;
              HOME = stateDir;
            } // lib.optionalAttrs cfg.disableBonjour { CLAWDBOT_DISABLE_BONJOUR = "1"; }
            // env;

          serviceConfig = {
            User = "bot-${b}";
            Group = "bot-${b}";
            WorkingDirectory = stateDir;

            ExecStartPre = lib.optional (seedWorkspaceScript != null) seedWorkspaceScript;
            ExecStart = "${clawPkg}/bin/clawdbot gateway";

            Restart = "always";
            RestartSec = "3";

            EnvironmentFile = lib.flatten [
              (lib.optional (envSecretsFile != null) "-${envSecretsFile}")
              (lib.optional ghEnabled "-${ghEnvFile}")
            ];

            NoNewPrivileges = true;
            PrivateTmp = true;
            ProtectSystem = "strict";
            ProtectHome = true;
            ReadWritePaths = lib.unique [ stateDir workspace ];
            UMask = "0077";

            CapabilityBoundingSet = "";
            AmbientCapabilities = "";
            LockPersonality = true;
            # Node/V8 JIT needs to toggle executable memory permissions.
            MemoryDenyWriteExecute = false;
            RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_NETLINK" "AF_UNIX" ];
            SystemCallArchitectures = "native";
          };
        };
      };

  perBotSecrets = lib.mkMerge (map mkBotSecret cfg.bots);
  perBotSkillSecrets = lib.mkMerge (map mkBotSkillSecrets cfg.bots);
  perBotTemplates = lib.mkMerge (map mkTemplate cfg.bots);
  perBotEnvTemplates = lib.mkMerge (map mkEnvTemplate cfg.bots);
in
{
  inherit
    mkBotUser
    mkBotGroup
    mkStateDir
    mkService
    perBotSecrets
    perBotSkillSecrets
    perBotTemplates
    perBotEnvTemplates;
}

