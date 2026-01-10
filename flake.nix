{
  description = "Hetzner NixOS: 4 Discord-only Clawdbot instances";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs";

    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";

    nix-clawdbot.url = "github:clawdbot/nix-clawdbot";
  };

  outputs = { self, nixpkgs, disko, sops-nix, nix-clawdbot, ... }:
    let
      system = "x86_64-linux";
    in {
      nixosConfigurations.bots01 = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = { inherit nix-clawdbot; };
        modules = [
          disko.nixosModules.disko
          sops-nix.nixosModules.sops

          ./infra/disko/bots01.nix
          ./infra/nix/hosts/bots01.nix
        ];
      };

      nixosModules.clawdbotFleet = import ./infra/nix/modules/clawdbot-fleet.nix;
    };
}
