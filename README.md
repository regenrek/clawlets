# Clawdlets

Clawdlets is the hetzner infrastructure companion for [clawdbot](https://github.com/clawdbot/clawdbot) and [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot). It provides the tooling to deploy and manage secure, reproducible bot fleets on Hetzner Cloud using NixOS. We simply handle the deployment plumbing for these core products.

🚧 Under construction: Don't use this as it is. Its currently WIP and only for advanced users.

Looking for official AWS Deploy? [clawdbot/clawdinators](https://github.com/clawdbot/clawdinators)

![Clawdlets Banner](public/clawdlets-banner.webp)

## Features

- **Discord bot fleet** – deploy multiple bots from one repo.
- **Secure by default** – WireGuard/Tailscale, lockdown, sops/age secrets.
- **Hetzner + NixOS** – immutable infra + reproducible deploys.
- **CLI-first** – bootstrap, deploy, ops, troubleshooting.
- **Atomic updates** – rollbacks via NixOS generations.

## Quickstart

Ready to ship? Check out the [Quickstart Guide](docs/quickstart.md) to get your fleet running in minutes.

## Documentation

- Start here: `docs/README.md`
- [Overview](docs/overview.md) – Mental model + lifecycle.
- [CLI Cookbook](docs/cli.md) – Common commands and patterns.
- [Config Reference](docs/config.md) – `infra/configs/clawdlets.json` reference.
- [Installation Guide](docs/install.md) – Prerequisites and setup.
- [Deployment & Updates](docs/deploy.md) – How to ship changes.
- [Agent Configuration](docs/agent-config.md) – Routing, skills, and workspaces.
- [Secrets Management](docs/secrets.md) – Handling keys safely with sops/age.
- [Security Model](docs/security.md) – Threat model + boundaries.
- [Operations Manual](docs/operations.md) – Day-to-day maintenance.
- [Troubleshooting](docs/troubleshooting.md) – Common failures and fixes.
- [Going Public](docs/publicing.md) – Checklist for OSS-safe publishing.
- [Upstream & Tracking](docs/upstream.md) – Keeping your fork in sync.


## Ask an agent (copy/paste prompt)

```text
  set -euo pipefail

  # ---- inputs (fill) ----
  PROJECT_DIR=./clawdlets-beta-test
  HOST=clawdlets-host-mj
  DISCORD_GUILD_ID="..."
  BOTS_JSON='["maren"]'                       # keep this aligned w/
  discordTokens below
  ADMIN_CIDR="1.2.3.4/32"                     # your current public IP /32
  DISK_DEVICE="/dev/sda"                      # adjust if needed
  SERVER_TYPE="cx43"

  # providers: pick what you actually use; doctor enforces required ones
  # (template defaults to ZAI model; envSecrets already set for ZAI)
  FLEET_ENVSECRETS_JSON='{
    "ZAI_API_KEY":"z_ai_api_key",
    "Z_AI_API_KEY":"z_ai_api_key",
    "ANTHROPIC_API_KEY":"anthropic_api_key",
    "OPENAI_API_KEY":"openai_api_key",
    "OPEN_AI_APIKEY":"openai_api_key"
  }'

  export HCLOUD_TOKEN="..."                   # required
  # export GITHUB_TOKEN="..."                 # only if your flake repo is
  private (Contents: read)

  # ---- 1) scaffold ----
  clawdlets project init --dir "$PROJECT_DIR" --host "$HOST"
  cd "$PROJECT_DIR"

  # ---- 2) git origin/base flake (required for bootstrap remote build) ----
  # option A (recommended): create repo + push
  # gh repo create <owner>/<repo> --private --source=. --remote=origin
  # option B: set origin yourself
  # git remote add origin git@github.com:<owner>/<repo>.git

  # ---- 3) configure canonical config (infra/configs/clawdlets.json) ----
  clawdlets fleet set --guild-id "$DISCORD_GUILD_ID"
  clawdlets config set --path fleet.bots --value-json "$BOTS_JSON"
  clawdlets config set --path fleet.envSecrets --value-json
  "$FLEET_ENVSECRETS_JSON"

  clawdlets host set --host "$HOST" \
    --enable true \
    --server-type "$SERVER_TYPE" \
    --admin-cidr "$ADMIN_CIDR" \
    --disk-device "$DISK_DEVICE" \
    --ssh-pubkey-file "$HOME/.ssh/id_ed25519.pub"

  # ---- 4) generate secrets (non-interactive; stdin, no plaintext file) ----
  # adminPasswordHash must be YESCRYPT (store as CI secret; don’t store
  plaintext password)
  clawdlets secrets init --from-json - --yes <<'JSON'
  {
    "adminPasswordHash": "<YESCRYPT_HASH>",
    "tailscaleAuthKey": "tskey-auth-...",
    "discordTokens": { "maren": "<DISCORD_BOT_TOKEN>" },
    "secrets": {
      "z_ai_api_key": "<ZAI_API_KEY>",
    }
  }
  JSON

  clawdlets doctor --scope deploy

  # ---- 5) commit + push (bootstrap pins to git SHA; must be on origin) ----
  git add -A
  git commit -m "chore: bootstrap clawdlets project"
  git push -u origin main

  # ---- 6) provision + install (prints Target IPv4) ----
  clawdlets bootstrap --rev HEAD

  # ---- 7) lockdown over tailnet (after tailscale up) ----
  # TS_IP=$(ssh admin@<ipv4> "tailscale ip -4 | head -n1")
  # clawdlets host set --host "$HOST" --target-host "admin@$TS_IP"
  # clawdlets lockdown --rev HEAD
```

## Powered By

Clawdlets is strictly an infrastructure wrapper. All credit for the AI assistant and Nix packaging goes to the core projects:

- [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot) by [joshp123](https://github.com/joshp123)
- [clawdbot](https://github.com/clawdbot/clawdbot) by [steipete](https://x.com/steipete)

## License

MIT

## Find me

[@kevinkernx](https://x.com/kevinkern)
