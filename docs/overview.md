# Overview

This repo = **public-safe infra + fleet config**.

Everything instance-specific (tokens/keys/IPs) lives in **`.clawdlets/`** (gitignored).

## What lives where

**In git**
- `infra/`: NixOS + Terraform + fleet module
- `docs/`: operating manual
- `cli/`: `clawdlets` (single entrypoint)
- `packages/core/`: shared logic (CLI + future UI)

**Not in git (`.clawdlets/`)**
- `stack.json`: instance config (hosts, flake base, terraform inputs)
- `.env`: local tokens needed for provisioning (Hetzner, optional GitHub)
- `secrets/`: sops/age keys + encrypted host secrets
- `extra-files/`: files injected during `nixos-anywhere` (host age key + host secrets)

## Deployment lifecycle (Hetzner)

0) (optional) scaffold a fresh project repo:
```bash
clawdlets project init --dir ./clawdlets-myproject
cd ./clawdlets-myproject
```

1) **Create stack**
```bash
clawdlets stack init
```

2) **Create secrets (sops/age)**
```bash
clawdlets secrets init
```

3) **Sanity checks**
```bash
clawdlets doctor
```

4) **Provision + install (Terraform + nixos-anywhere)**
```bash
clawdlets bootstrap
```

5) **Lock down (after tailnet works)**
```bash
clawdlets lockdown --target-host admin@<tailscale-ip>
```

6) **Operate**
- status: `clawdlets server status --target-host <host>`
- logs: `clawdlets server logs --target-host <host> --unit clawdbot-melinda.service --follow`
- rebuild pinned: `just server-rebuild-rev <host> HEAD`

## Secrets model (important)

- Host secrets file lives on the **host filesystem**:
  - `/var/lib/clawdlets/secrets/hosts/<host>.yaml`
- `sops-nix` reads it from that path (so secrets don’t end up in `/nix/store`).
- `nixos-anywhere` injects on first install via `.clawdlets/extra-files/<host>/...`.

See `docs/secrets.md` and `docs/security.md`.
