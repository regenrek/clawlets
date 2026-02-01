{ config, lib, ... }:

let
  cfg = config.clawdlets.cacheServers.harmonia;
  allowMissingSecrets = config.clawdlets.bootstrap.allowMissingSecrets or false;

  defaultHostSecretsDir = "/var/lib/clawdlets/secrets/hosts/${config.networking.hostName}";
  hostSecretsDir =
    if (config.clawdlets.secrets.hostDir or null) != null
    then config.clawdlets.secrets.hostDir
    else defaultHostSecretsDir;
in
{
  options.clawdlets.cacheServers.harmonia = {
    enable = lib.mkEnableOption "Harmonia binary cache server";

    signKeySecretName = lib.mkOption {
      type = lib.types.str;
      default = "harmonia_sign_key";
      description = "Sops secret name containing the Harmonia signing key (nix-store --generate-binary-cache-key secret key contents).";
    };

    signKeyPath = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/secrets/harmonia.secret";
      description = "Filesystem path for the Harmonia signing key (root-owned, 0400).";
    };

    public = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Expose Harmonia publicly via nginx+ACME (recommended). If false, Harmonia listens locally and you should provide your own reverse proxy / tailnet access.";
    };

    domain = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Public hostname (required when public=true).";
    };

    acmeEmail = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "ACME account email (required when public=true).";
    };

    upstreamHost = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Upstream host for nginx proxy_pass.";
    };

    upstreamPort = lib.mkOption {
      type = lib.types.int;
      default = 5000;
      description = "Upstream port for nginx proxy_pass (Harmonia default).";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = !allowMissingSecrets;
        message = "clawdlets.cacheServers.harmonia.enable requires secrets (disable clawdlets.bootstrap.allowMissingSecrets).";
      }
      {
        assertion = (!cfg.public) || (cfg.domain != null && cfg.domain != "" && cfg.acmeEmail != null && cfg.acmeEmail != "");
        message = "clawdlets.cacheServers.harmonia: domain + acmeEmail are required when public=true.";
      }
    ];

    sops.secrets.${cfg.signKeySecretName} = {
      owner = "root";
      group = "root";
      mode = "0400";
      path = cfg.signKeyPath;
      sopsFile = "${hostSecretsDir}/${cfg.signKeySecretName}.yaml";
    };

    services.harmonia = {
      enable = true;
      signKeyPaths = [ config.sops.secrets.${cfg.signKeySecretName}.path ];
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.public [ 80 443 ];

    security.acme = lib.mkIf cfg.public {
      acceptTerms = true;
      defaults.email = cfg.acmeEmail;
    };

    services.nginx = lib.mkIf cfg.public {
      enable = true;
      recommendedTlsSettings = true;

      virtualHosts.${cfg.domain} = {
        enableACME = true;
        forceSSL = true;
        locations."/".extraConfig = ''
          proxy_pass http://${cfg.upstreamHost}:${toString cfg.upstreamPort};
          proxy_set_header Host $host;
          proxy_redirect http:// https://;
          proxy_http_version 1.1;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection $connection_upgrade;
        '';
      };
    };
  };
}

