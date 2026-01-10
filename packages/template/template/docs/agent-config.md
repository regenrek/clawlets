# Agent config (routing + skills + workspaces)

Single source of truth:

- `infra/configs/fleet.nix`

Rendered per-bot Clawdbot config:

- Nix generates `clawdbot-<bot>.json` and injects secrets at activation time.

## Routing (Discord)

Edit `infra/configs/fleet.nix`:

- `guildId`
- `routing.<bot>.channels` (slugged, lowercase, no `#`)
- `routing.<bot>.requireMention`

If you change `bots`, update `.clawdlets/secrets/hosts/<host>.yaml` with matching `discord_token_<name>` keys, sync, then rebuild.

## Documents (AGENTS / SOUL / TOOLS / IDENTITY)

Seed workspace docs from:

```nix
documentsDir = ./documents;
```

This uses the existing workspace seed mechanism and only copies when the workspace is empty.
Keep `infra/documents/` as the canonical source.

## Identity (optional)

Set a shared agent identity:

```nix
identity = {
  name = "Clawdbot Fleet";
  # emoji = ":robot:";
};
```

## Gateway ports

Default port is `services.clawdbotFleet.gatewayPortBase` plus a stride:

```nix
services.clawdbotFleet.gatewayPortBase = 18789;
services.clawdbotFleet.gatewayPortStride = 10;
```

Per-bot override (example):

```nix
botProfiles.melinda.extraConfig.gateway.port = 18819;
```

## Model defaults (provider/model)

Set a default model for all agents:

```nix
services.clawdbotFleet.agentModelPrimary = "zai/glm-4.7";
```

Optional extra model entries:

```nix
services.clawdbotFleet.agentModels = {
  "fast" = "zai/glm-4.2";
};
```

Per-bot override:

```nix
botProfiles.melinda.extraConfig.agents.defaults.modelPrimary = "zai/glm-4.7";
```

Provider API keys:

```nix
botProfiles.melinda.envSecrets.ZAI_API_KEY = "z_ai_api_key";
```

This renders into a per-bot env file and is loaded by systemd.

## Codex CLI (server)

Enable Codex CLI for selected bots:

```nix
codex = {
  enable = true;
  bots = [ "gunnar" "maren" ];
};
```

Then allow bundled `coding-agent` for those bots:

```nix
botProfiles.gunnar.skills.allowBundled = [ "github" "coding-agent" ];
botProfiles.maren.skills.allowBundled = [ "github" "brave-search" "coding-agent" ];
```

One-time login (headless):

```bash
sudo -u bot-maren env HOME=/srv/clawdbot/maren codex login --device-auth
sudo -u bot-gunnar env HOME=/srv/clawdbot/gunnar codex login --device-auth
```

## Bonjour / mDNS (optional)

If mDNS errors appear on `wg0`, disable Bonjour:

```nix
services.clawdbotFleet.disableBonjour = true;
```

## Per-bot profiles (`botProfiles`)

Each bot can have different:

- bundled skill allowlist
- per-skill env + secrets
- webhook/hook config + secrets
- GitHub App auth config (for non-interactive `gh` + git pushes)
- workspace seed repo
- per-bot service env (provider API keys, etc.)

### Long-term memory / knowledge base (workspace)

Each bot gets an isolated workspace at:

- `/srv/clawdbot/<bot>/workspace` (default)

Override:

- `botProfiles.<bot>.agent.workspace = "/some/path"`

Optional seed-once:

- `botProfiles.<bot>.workspace.seedDir = ./workspaces/<bot>`
- copied only when the workspace is empty.

### Skills

Allowlist bundled skills:

- `botProfiles.<bot>.skills.allowBundled = [ "github" "brave-search" ... ]`

Per-skill secrets (recommended):

- `botProfiles.<bot>.skills.entries."<skill>".envSecrets.<ENV_VAR> = "<sops_secret_name>"`
- `botProfiles.<bot>.skills.entries."<skill>".apiKeySecret = "<sops_secret_name>"`

### Per-bot service env (provider API keys)

Use this for model provider API keys (e.g. ZAI, OpenAI, etc.).

- `botProfiles.<bot>.envSecrets.<ENV_VAR> = "<sops_secret_name>"`

Note: enabling `"coding-agent"` pulls large packages (Codex CLI + deps) into the NixOS closure and can
OOM small remote build machines during bootstrap. Prefer enabling it only after the host is up (swap
enabled) or use a bigger build machine.

### Hooks (Gmail/webhooks)

Secrets:

- `botProfiles.<bot>.hooks.tokenSecret = "<sops_secret_name>"`
- `botProfiles.<bot>.hooks.gmailPushTokenSecret = "<sops_secret_name>"`

Non-secret config:

- `botProfiles.<bot>.hooks.config = { ... }`

### GitHub App auth (maren)

Configure:

```nix
botProfiles.maren.github = {
  appId = 123456;
  installationId = 12345678;
  privateKeySecret = "gh_app_private_key_maren";
  refreshMinutes = 45;
};
```

Effect on host:

- refreshes `GH_TOKEN` into `/srv/clawdbot/maren/credentials/gh.env`
- writes git HTTPS creds to `/srv/clawdbot/maren/credentials/git-credentials`
- writes `/srv/clawdbot/maren/.gitconfig` pointing git at that creds file

### Codex CLI OAuth (ChatGPT subscription)

Bot services run with `HOME=/srv/clawdbot/<bot>`, so Codex stores OAuth state at:

- `/srv/clawdbot/<bot>/.codex/auth.json`

One-time login on the host:

```bash
sudo -u bot-maren env HOME=/srv/clawdbot/maren codex login --device-auth
```

## Admin access (WireGuard + Tailscale)

WireGuard is used for admin SSH by default. Tailscale is also supported and
recommended for ease of access:

- enable in `infra/nix/hosts/bots01.nix` via `services.clawdbotFleet.tailscale.enable = true;`
- on the host, run `sudo tailscale up` once (unless using an auth key)
