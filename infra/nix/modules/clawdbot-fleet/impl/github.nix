{ config, lib, pkgs, defs }:

let
  inherit (defs) cfg getBotProfile resolveBotWorkspace resolveBotCredsDir;

  mkGithubTokenService = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      enabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      stateDir = "${cfg.stateDirBase}/${b}";
      credsDir = resolveBotCredsDir b;
      envFile = "${credsDir}/gh.env";
      gitCredsFile = "${credsDir}/git-credentials";
      gitConfigFile = "${stateDir}/.gitconfig";
      privateKeyPath = config.sops.secrets.${gh.privateKeySecret}.path;
      appId = toString gh.appId;
      installationId = toString gh.installationId;
      mintScript = pkgs.writeShellScript "clawdbot-gh-token-${b}" ''
        set -euo pipefail

        b64url() {
          ${pkgs.coreutils}/bin/base64 -w0 | tr '+/' '-_' | tr -d '='
        }

        now="$(${pkgs.coreutils}/bin/date +%s)"
        iat="$((now - 30))"
        exp="$((now + 540))" # GitHub requires exp within 10 minutes

        header='{"alg":"RS256","typ":"JWT"}'
        payload="{\"iat\":$iat,\"exp\":$exp,\"iss\":\"${appId}\"}"

        h64="$(printf '%s' "$header" | b64url)"
        p64="$(printf '%s' "$payload" | b64url)"
        signing_input="$h64.$p64"
        sig="$(
          printf '%s' "$signing_input" \
            | ${pkgs.openssl}/bin/openssl dgst -sha256 -sign '${privateKeyPath}' -binary \
            | b64url
        )"
        jwt="$signing_input.$sig"

        token_json="$(
          ${pkgs.curl}/bin/curl -fsS \
            -X POST \
            -H "Authorization: Bearer $jwt" \
            -H "Accept: application/vnd.github+json" \
            "https://api.github.com/app/installations/${installationId}/access_tokens"
        )"

        token="$(printf '%s' "$token_json" | ${pkgs.jq}/bin/jq -r '.token')"
        if [ -z "$token" ] || [ "$token" = "null" ]; then
          echo "failed to mint GitHub installation token (no .token field)" >&2
          printf '%s\n' "$token_json" >&2
          exit 1
        fi

        umask 077

        tmp_env="$(${pkgs.coreutils}/bin/mktemp)"
        printf 'GH_TOKEN=%s\n' "$token" > "$tmp_env"
        ${pkgs.coreutils}/bin/chown "bot-${b}:bot-${b}" "$tmp_env"
        ${pkgs.coreutils}/bin/chmod 0400 "$tmp_env"
        ${pkgs.coreutils}/bin/mv "$tmp_env" '${envFile}'

        tmp_creds="$(${pkgs.coreutils}/bin/mktemp)"
        printf 'https://x-access-token:%s@github.com\n' "$token" > "$tmp_creds"
        ${pkgs.coreutils}/bin/chown "bot-${b}:bot-${b}" "$tmp_creds"
        ${pkgs.coreutils}/bin/chmod 0600 "$tmp_creds"
        ${pkgs.coreutils}/bin/mv "$tmp_creds" '${gitCredsFile}'

        tmp_gitcfg="$(${pkgs.coreutils}/bin/mktemp)"
        cat > "$tmp_gitcfg" <<EOF
[credential]
	helper = store --file ${gitCredsFile}
EOF
        ${pkgs.coreutils}/bin/chown "bot-${b}:bot-${b}" "$tmp_gitcfg"
        ${pkgs.coreutils}/bin/chmod 0600 "$tmp_gitcfg"
        ${pkgs.coreutils}/bin/mv "$tmp_gitcfg" '${gitConfigFile}'
      '';
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-token-${b}" = {
          description = "Mint GitHub App installation token for bot ${b}";
          after = [ "network-online.target" "sops-nix.service" ];
          wants = [ "network-online.target" "sops-nix.service" ];
          serviceConfig = {
            Type = "oneshot";
            ExecStart = mintScript;

            User = "root";
            Group = "root";

            NoNewPrivileges = true;
            PrivateTmp = true;
            ProtectSystem = "strict";
            ProtectHome = true;
            ReadWritePaths = [ stateDir ];
            UMask = "0077";

            CapabilityBoundingSet = "";
            AmbientCapabilities = "";
            LockPersonality = true;
            MemoryDenyWriteExecute = true;
            RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_NETLINK" "AF_UNIX" ];
            SystemCallArchitectures = "native";
          };
        };
      };

  mkGithubTokenTimer = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      enabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      refreshMinutes = toString (gh.refreshMinutes or 45);
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-token-${b}" = {
          description = "Refresh GitHub App token for bot ${b}";
          wantedBy = [ "timers.target" ];
          timerConfig = {
            OnBootSec = "2m";
            OnUnitActiveSec = "${refreshMinutes}m";
            RandomizedDelaySec = "2m";
            Persistent = true;
            Unit = "clawdbot-gh-token-${b}.service";
          };
        };
      };

  mkGithubSyncService = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      ghEnabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      stateDir = "${cfg.stateDirBase}/${b}";
      workspace = resolveBotWorkspace b;
      credsDir = resolveBotCredsDir b;
      ghEnvFile = "${credsDir}/gh.env";
      reposEnv = lib.concatStringsSep " " cfg.githubSync.repos;
      enabled = cfg.githubSync.enable && ghEnabled;
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-sync-${b}" = {
          description = "Sync GitHub PRs/issues into bot workspace memory (${b})";
          after = [ "network-online.target" ] ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service";
          wants = [ "network-online.target" ] ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service";
          serviceConfig = {
            Type = "oneshot";
            User = "bot-${b}";
            Group = "bot-${b}";
            WorkingDirectory = stateDir;
            EnvironmentFile = lib.optional ghEnabled "-${ghEnvFile}";

            NoNewPrivileges = true;
            PrivateTmp = true;
            ProtectSystem = "strict";
            ProtectHome = true;
            ReadWritePaths = lib.unique [ stateDir workspace ];
            UMask = "0077";

            CapabilityBoundingSet = "";
            AmbientCapabilities = "";
            LockPersonality = true;
            MemoryDenyWriteExecute = true;
            RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_NETLINK" "AF_UNIX" ];
            SystemCallArchitectures = "native";
          };
          path = [ pkgs.bash pkgs.coreutils pkgs.gh pkgs.jq ];
          environment = {
            GH_PAGER = "cat";
            GIT_PAGER = "cat";
            MEMORY_DIR = "${workspace}/memory";
            ORG = cfg.githubSync.org;
          } // lib.optionalAttrs (cfg.githubSync.repos != []) { REPOS = reposEnv; };
          script = ''
            exec /etc/clawdlets/bin/gh-sync
          '';
        };
      };

  mkGithubSyncTimer = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      ghEnabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      enabled = cfg.githubSync.enable && ghEnabled;
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-sync-${b}" = {
          description = "Periodic GitHub sync for bot ${b}";
          wantedBy = [ "timers.target" ];
          timerConfig = {
            OnCalendar = cfg.githubSync.schedule;
            RandomizedDelaySec = "2m";
            Persistent = true;
            Unit = "clawdbot-gh-sync-${b}.service";
          };
        };
      };
in
{
  inherit mkGithubTokenService mkGithubTokenTimer mkGithubSyncService mkGithubSyncTimer;
}

