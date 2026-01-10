# Troubleshooting

## `ssh-keygen` / “REMOTE HOST IDENTIFICATION HAS CHANGED”

After reinstall, host key changes.

```bash
ssh-keygen -R <ipv4>
ssh-keygen -R "[<ipv4>]:22" || true
```

`clawdlets bootstrap` also clears known_hosts entries.

## Terraform unfree error (terraform is BSL)

If you run terraform via nix directly:

```bash
NIXPKGS_ALLOW_UNFREE=1 nix run --impure nixpkgs#terraform -- -chdir=infra/terraform plan
```

`clawdlets infra apply` already sets allow-unfree.

## GitHub flake fetch 404

If your base flake repo is private, set `GITHUB_TOKEN` in `.clawdlets/.env` (fine-grained PAT, Contents read).

## `journalctl --since 5m` parse error

Use `--since "5 min ago"` or `clawdlets server logs --since 5m` (CLI normalizes `5m`).

## `sudo: a terminal is required`

Use SSH TTY:

```bash
ssh -t <host> "sudo systemctl status clawdbot-melinda --no-pager"
```

CLI commands that may need sudo default to `--ssh-tty=true`.

## Gateway port already in use

Check listeners:

```bash
ssh -t <host> "sudo ss -ltnp | grep ':187' || true"
```

Restart the unit:

```bash
clawdlets server restart --target-host <host> --unit clawdbot-melinda.service
```
