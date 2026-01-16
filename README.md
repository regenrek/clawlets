# Clawdlets

Clawdlets is the hetzner infrastructure companion for [clawdbot](https://github.com/clawdbot/clawdbot) and [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot). It provides the tooling to deploy and manage secure, reproducible bot fleets on Hetzner Cloud using NixOS. The infra template lives in `regenrek/clawdlets-template`; this repo is the CLI + docs.

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

## Local hooks (recommended)

- Install git hooks: `nix run nixpkgs#lefthook -- install -f`
- Policy is in `.forbidden-paths.regex` (blocks committing local runtime + credential files).
- Manual gate before PR/release: `pnpm gate`

## Ask an agent (copy/paste prompt)

```text
clawdlets project init --dir ~/projects/clawdlets-project
cd ~/projects/clawdlets-project

Now start Codex/Claude and tell it
read @AGENT-BOOTSTRAP-SERVER.md and help me setup my own clawdlets hetzner server
```

## Documentation

- Start here: `docs/README.md`
- [Overview](docs/overview.md) – Mental model + lifecycle.
- [CLI Cookbook](docs/cli.md) – Common commands and patterns.
- [Config Reference](docs/config.md) – `fleet/clawdlets.json` reference.
- [Installation Guide](docs/install.md) – Prerequisites and setup.
- [Deployment & Updates](docs/deploy.md) – How to ship changes.
- [Agent Configuration](docs/agent-config.md) – Routing, skills, and workspaces.
- [Secrets Management](docs/secrets.md) – Handling keys safely with sops/age.
- [Security Model](docs/security.md) – Threat model + boundaries.
- [Operations Manual](docs/operations.md) – Day-to-day maintenance.
- [Troubleshooting](docs/troubleshooting.md) – Common failures and fixes.
- [Going Public](docs/publicing.md) – Checklist for OSS-safe publishing.
- [Upstream & Tracking](docs/upstream.md) – Keeping your fork in sync.

## Powered By

Clawdlets is strictly an infrastructure wrapper. All credit for the AI assistant and Nix packaging goes to the core projects:

- [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot) by [joshp123](https://github.com/joshp123)
- [clawdbot](https://github.com/clawdbot/clawdbot) by [steipete](https://x.com/steipete)

## License

MIT

## Find me

[@kevinkernx](https://x.com/kevinkern)
