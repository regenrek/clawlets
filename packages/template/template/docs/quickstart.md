# Quickstart (CLI-first)

Goal: provision a Hetzner VM + install NixOS + bring up Discord bots, with instance data living in `.clawdlets/` (gitignored).

## Prereqs (local)

- Nix installed (`nix --version`)
- Node 22+ (for `clawdlets`)
- SSH keypair (`~/.ssh/id_ed25519.pub` recommended)

## CLI commands

Run `clawdlets --help` for full flags.

If you’re developing inside this monorepo, use the pnpm wrappers (example):
`pnpm run clawdlets:stack -- init` == `clawdlets stack init`

- `clawdlets stack init`: create `.clawdlets/stack.json` + `.clawdlets/.env`.
- `clawdlets doctor`: validates local prereqs before provisioning (stack, tokens, ssh key path).
- `clawdlets secrets init`: generates age keys + `.clawdlets/extra-files/<host>/.../key.txt` + encrypts `.clawdlets/secrets/hosts/<host>.yaml`.
- `clawdlets bootstrap`: runs Terraform + `nixos-anywhere` install (prints target IPv4; clears stale `known_hosts`).
- `clawdlets infra apply`: terraform apply only (bootstrap SSH toggle).
- `clawdlets lockdown`: rebuild over VPN/tailnet and remove public SSH from Hetzner firewall.
- `clawdlets server <cmd>`: run server-side operations over SSH (`status`, `logs`, `restart`, `rebuild`).

## Recommended workflow (new host)

0) (optional) create a fresh project repo:
```bash
clawdlets project init --dir ./clawdlets-myproject
cd ./clawdlets-myproject
```

1) Configure fleet:
- edit `infra/configs/fleet.nix` (`bots = [ ... ]`, routing, profiles)
- keep `infra/documents/` up to date (AGENTS/SOUL/TOOLS/IDENTITY)

2) Create stack + secrets:
```bash
clawdlets stack init
clawdlets secrets init
```

3) Provision + install:
```bash
clawdlets bootstrap
```

4) Verify access:
- SSH: `ssh admin@<ipv4>`
- Console: `admin` login should work (sudo password exists; SSH stays key-only)

5) Lock down after VPN/tailnet works:
- ensure `services.clawdbotFleet.bootstrapSsh = false;` in `infra/nix/hosts/<host>.nix`
- then:
```bash
clawdlets lockdown --target-host admin@<tailscale-ip>
```

6) Rebuild (pinned to a full commit SHA):
```bash
clawdlets server rebuild --target-host admin@<ipv4> --rev HEAD
```

`--rev HEAD` resolves to the full SHA locally before the remote build.

## Server checks

```bash
clawdlets server status --target-host admin@<ipv4>
clawdlets server logs --target-host admin@<ipv4> --unit clawdbot-maren.service --since 15m --follow
```

## Common follow-ups

- Change tokens/passwords: edit `.clawdlets/secrets/hosts/<host>.yaml` with sops, sync, rebuild.
- Add another operator machine: add their age public key to `.clawdlets/secrets/.sops.yaml` recipients for that host and re-encrypt.
