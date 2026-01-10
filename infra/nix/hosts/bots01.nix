{ config, lib, ... }:

let
  fleet = import ../../configs/fleet.nix { inherit lib; };
  enableRootPassword = false;
in {
  imports = [
    ../modules/clawdbot-fleet.nix
  ];

  networking.hostName = "bots01";
  networking.nameservers = [
    "1.1.1.1"
    "1.0.0.1"
    "2606:4700:4700::1111"
    "2606:4700:4700::1001"
  ];

  networking.useDHCP = false;
  networking.useNetworkd = true;

  systemd.network.networks."10-uplink" = {
    matchConfig.Name = "en*";
    networkConfig = {
      DHCP = "ipv4";
      IPv6AcceptRA = true;
    };
  };

  time.timeZone = "UTC";
  system.stateVersion = "25.11";

  users.mutableUsers = false;

  sops.secrets.admin_password_hash = {
    owner = "root";
    group = "root";
    mode = "0400";
    neededForUsers = true;
  };

  sops.secrets.root_password_hash = lib.mkIf enableRootPassword {
    owner = "root";
    group = "root";
    mode = "0400";
    neededForUsers = true;
  };

  users.users.admin = {
    isNormalUser = true;
    extraGroups = [ "wheel" ];
    hashedPasswordFile = config.sops.secrets.admin_password_hash.path;
    openssh.authorizedKeys.keys = [];
  };

  users.users.root.hashedPasswordFile =
    lib.mkIf enableRootPassword config.sops.secrets.root_password_hash.path;

  security.sudo.extraConfig = ''
    Cmnd_Alias CLAWDBOT_SYSTEMCTL = \
      /run/current-system/sw/bin/systemctl status clawdbot-*, \
      /run/current-system/sw/bin/systemctl status clawdbot-* --no-pager, \
      /run/current-system/sw/bin/systemctl status clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl status clawdbot-*.service --no-pager, \
      /run/current-system/sw/bin/systemctl start clawdbot-*, \
      /run/current-system/sw/bin/systemctl start clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl stop clawdbot-*, \
      /run/current-system/sw/bin/systemctl stop clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl restart clawdbot-*, \
      /run/current-system/sw/bin/systemctl restart clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-*, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-* --no-pager, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-*.service --no-pager, \
      /run/current-system/sw/bin/systemctl show clawdbot-*, \
      /run/current-system/sw/bin/systemctl show clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl cat clawdbot-*, \
      /run/current-system/sw/bin/systemctl cat clawdbot-*.service
    Cmnd_Alias CLAWDBOT_JOURNAL = \
      /run/current-system/sw/bin/journalctl -u clawdbot-* --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawdbot-* -n * --no-pager
    Cmnd_Alias CLAWDBOT_SS = /run/current-system/sw/bin/ss -ltnp
    Cmnd_Alias CLAWDBOT_REBUILD = \
      /run/current-system/sw/bin/nixos-rebuild, \
      /run/current-system/sw/bin/env /run/current-system/sw/bin/nixos-rebuild switch --flake *, \
      /run/current-system/sw/bin/env NIX_CONFIG=access-tokens\ =\ github.com=* /run/current-system/sw/bin/nixos-rebuild switch --flake *, \
      /run/current-system/sw/bin/env nixos-rebuild switch --flake *, \
      /run/current-system/sw/bin/env NIX_CONFIG=access-tokens\ =\ github.com=* nixos-rebuild switch --flake *
    admin ALL=(root) NOPASSWD: CLAWDBOT_SYSTEMCTL, CLAWDBOT_JOURNAL, CLAWDBOT_SS, CLAWDBOT_REBUILD
  '';

  services.clawdbotFleet = {
    enable = false;
    bots = fleet.bots;
    guildId = fleet.guildId;
    routing = fleet.routing;
    botProfiles = fleet.botProfiles;
    backups = fleet.backups;
    documentsDir = fleet.documentsDir;
    identity = fleet.identity;
    codex = fleet.codex;
    tailscale.enable = false;
    bootstrapSsh = false;
    disableBonjour = true;
    agentModelPrimary = "zai/glm-4.7";
  };
}
