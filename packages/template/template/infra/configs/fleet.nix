{ lib }:
let
  zaiEnv = {
    ZAI_API_KEY = "z_ai_api_key";
    Z_AI_API_KEY = "z_ai_api_key";
  };
  gatewayPorts = {
    maren = 18789;
    sonja = 18799;
    gunnar = 18809;
    melinda = 18819;
  };
  baseBot = {
    envSecrets = zaiEnv;
    skills = {
      allowBundled = null;
      entries = {};
    };
    extraConfig = {};
  };
  mkBot = overrides: lib.recursiveUpdate baseBot overrides;
in {
  bots = [
    "maren"
    "sonja"
    "gunnar"
    "melinda"
  ];

  # set this to your Discord guild/server id
  guildId = "";

  documentsDir = ./documents;
  identity = null;

  codex = {
    enable = true;
    bots = [ "gunnar" "maren" ];
  };

  # Per-bot profile config:
  # - skills: bundled allowlist + per-skill env/apiKey secret wiring (sops secret names)
  # - workspace: optional seed dir (copied into empty workspace on first start)
  botProfiles = {
    maren = mkBot {
      extraConfig = {
        gateway.port = gatewayPorts.maren;
      };
      skills = {
        # Keep bootstrap builds small by default. Enabling "coding-agent" pulls in
        # heavy packages (codex/oracle) and can OOM small build machines.
        allowBundled = [ "github" "brave-search" "coding-agent" ];
        entries = {
          # Example: inject an API key as a skill env var, backed by sops.
          # "brave-search" = {
          #   envSecrets = { BRAVE_API_KEY = "brave_api_key_maren"; };
          # };
        };
      };

      # GitHub App auth for gh/git (minted + refreshed on-host; no PATs).
      # github = {
      #   appId = 123456;
      #   installationId = 12345678;
      #   privateKeySecret = "gh_app_private_key_maren";
      #   refreshMinutes = 45;
      # };

      # Example: enable webhooks + keep tokens in sops.
      # hooks = {
      #   enabled = true;
      #   tokenSecret = "clawdbot_hook_token_maren";
      #   gmailPushTokenSecret = "gog_push_token_maren";
      #   config = {
      #     path = "/hooks";
      #     presets = [ "gmail" ];
      #     gmail = {
      #       account = "maren@example.com";
      #       topic = "projects/<project-id>/topics/gog-gmail-watch";
      #       subscription = "gog-gmail-watch-push";
      #       hookUrl = "http://127.0.0.1:18789/hooks/gmail";
      #     };
      #   };
      # };
      # workspace.seedDir = ./workspaces/maren;
    };

    sonja = mkBot {
      extraConfig = {
        gateway.port = gatewayPorts.sonja;
      };
      skills = {
        allowBundled = [ "notion" ];
      };
    };

    gunnar = mkBot {
      extraConfig = {
        gateway.port = gatewayPorts.gunnar;
      };
      skills = {
        allowBundled = [ "github" "coding-agent" ];
      };
    };

    melinda = mkBot {
      extraConfig = {
        gateway.port = gatewayPorts.melinda;
      };
      skills = {
        allowBundled = [ "brave-search" ];
      };
    };
  };

  backups = {
    restic = {
      enable = false;
      repository = "";
      passwordSecret = "restic_password";
      environmentSecret = null;
      # paths = [ "/srv/clawdbot" ];
      # timerConfig = { OnCalendar = "daily"; RandomizedDelaySec = "1h"; Persistent = "true"; };
    };
  };

  routing = {
    # fill per-bot allowlist (channel slugs)
    maren = { channels = [ ]; requireMention = true; };
    sonja = { channels = [ ]; requireMention = true; };
    gunnar = { channels = [ ]; requireMention = true; };
    melinda = { channels = [ ]; requireMention = true; };
  };
}
