{
  description = "__PROJECT_NAME__";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs";

    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";

    nix-clawdbot.url = "github:clawdbot/nix-clawdbot";
    nix-clawdbot.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, disko, sops-nix, nix-clawdbot, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      cfg = builtins.fromJSON (builtins.readFile ./infra/configs/clawdlets.json);
      hostNamesRaw = builtins.attrNames (cfg.hosts or { });
      hostNames =
        if hostNamesRaw == [ ] then
          throw "infra/configs/clawdlets.json must define at least one host under .hosts"
        else
          hostNamesRaw;
      flakeInfo = {
        clawdlets = {
          rev = self.rev or null;
          lastModifiedDate = self.lastModifiedDate or null;
        };
        nixpkgs = {
          rev = nixpkgs.rev or null;
          lastModifiedDate = nixpkgs.lastModifiedDate or null;
        };
        nix-clawdbot = {
          rev = nix-clawdbot.rev or null;
          lastModifiedDate = nix-clawdbot.lastModifiedDate or null;
        };
      };
    in {
      nixosConfigurations = nixpkgs.lib.genAttrs hostNames (hostName:
        nixpkgs.lib.nixosSystem {
          inherit system;
          specialArgs = { inherit nix-clawdbot flakeInfo; };
          modules = [
            disko.nixosModules.disko
            sops-nix.nixosModules.sops

            ./infra/nix/modules/clawdlets-host-meta.nix
            ({ ... }: {
              clawdlets.hostName = hostName;
            })

            ./infra/disko/example.nix
            ./infra/nix/hosts/clawdlets-host.nix
          ];
        });

      nixosModules.clawdbotFleet = import ./infra/nix/modules/clawdbot-fleet.nix;
      packages = {
        ${system} =
          let
            byHost = builtins.listToAttrs (map (hostName: {
              name = "${hostName}-system";
              value = self.nixosConfigurations.${hostName}.config.system.build.toplevel;
            }) hostNames);
            first = builtins.elemAt hostNames 0;
          in
            byHost // {
              default = byHost."${first}-system";
            };
      };
    };
}
