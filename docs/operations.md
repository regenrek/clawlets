# Operations

## Update routing / profiles

1) Edit `infra/configs/fleet.nix`
2) Rebuild:

```bash
just server-rebuild-rev admin@<ipv4> HEAD
# or:
clawdlets server rebuild --target-host admin@<ipv4> --rev HEAD
```

`--rev HEAD` resolves to the full SHA locally before the remote build.

## Rotate tokens/secrets

1) Edit `.clawdlets/secrets/hosts/bots01.yaml`
2) Re-encrypt (or use `clawdlets secrets init` to regenerate)
3) Sync + rebuild

## Verify

```bash
clawdlets server status --target-host admin@<ipv4>
clawdlets server logs --target-host admin@<ipv4> --unit clawdbot-maren.service --follow
```

Justfile:
```bash
just server-units admin@<ipv4>
just server-logs admin@<ipv4> "--unit clawdbot-maren.service --follow"
```

## Health

```bash
clawdlets server logs --target-host admin@<ipv4> --since 15m
```

Justfile:
```bash
just server-health admin@<ipv4>
```

## Codex CLI (headless)

One-time device auth per bot:

```bash
sudo -u bot-maren env HOME=/srv/clawdbot/maren codex login --device-auth
sudo -u bot-gunnar env HOME=/srv/clawdbot/gunnar codex login --device-auth
```

## Tailscale

```bash
tailscale status
tailscale ip -4
```

## GitHub App token refresher (maren)

```bash
systemctl status clawdbot-gh-token-maren
systemctl status clawdbot-gh-token-maren.timer
```

## Backups (restic)

Enable in `infra/configs/fleet.nix` (or override in host config):

```nix
backups.restic = {
  enable = true;
  repository = "s3:s3.amazonaws.com/<bucket>/clawdbot";
  passwordSecret = "restic_password";
  # environmentSecret = "restic_env"; # optional, e.g. AWS_ACCESS_KEY_ID=...
};
```

Add secrets to `.clawdlets/secrets/hosts/bots01.yaml`, sync, then rebuild.

Restore (example, run as root on the host):

```bash
restic snapshots
restic restore latest --target / --include /srv/clawdbot
```
