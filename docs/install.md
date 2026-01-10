# Install (Hetzner + nixos-anywhere + Terraform)

## Inputs

- `infra/configs/fleet.nix` (routing + botProfiles)
- `infra/nix/hosts/bots01.nix` (host keys + WireGuard peers)
- `.clawdlets/` (gitignored: stack + sops/age + tokens + extra-files)
- `infra/disko/bots01.nix` (disk device)
- `infra/documents/*` (AGENTS/SOUL/TOOLS/IDENTITY seeded into workspaces)

## Hetzner Cloud specifics (non-negotiable)

- Firmware: legacy BIOS (SeaBIOS) → GRUB (i386-pc) + GPT `EF02` BIOS boot partition (no EFI/systemd-boot).
- Networking: DHCP via `systemd-networkd` (Hetzner hands out `/32` + gateway `172.31.1.1`).
- Initrd: must include virtio modules or the VM won’t boot (`virtio_*` in `boot.initrd.availableKernelModules`).

## Tooling bundle (optional)

Default install uses `clawdbot-gateway` only (small, reliable bootstrap).

If you want the additional tools in PATH (e.g. `summarize`, `oracle`, etc), enable:

```nix
services.clawdbotFleet.tools.enable = true;
```

## 0) Prefill checklist

- `infra/configs/fleet.nix`
  - `guildId`
  - per-bot `routing`
  - per-bot `botProfiles` (skills/hooks/github)
- `infra/nix/hosts/bots01.nix`
  - `users.users.admin.openssh.authorizedKeys.keys`
  - `services.clawdbotFleet.wireguard.adminPeers`
- `.clawdlets/secrets/.sops.yaml`
  - age recipients (host + operators) for `bots01.yaml` (via filename override)
- `.clawdlets/secrets/hosts/bots01.yaml`
  - `wg_private_key`
  - `admin_password_hash` (required; for `sudo` on admin user)
  - `discord_token_<bot>`
  - optional: skill secrets / hook tokens / GitHub App key / restic secrets
  - optional: `root_password_hash` (console-only; keep root SSH disabled; requires `enableRootPassword = true`)
- `.clawdlets/extra-files/bots01/var/lib/sops-nix/key.txt`
  - host age key installed to `/var/lib/sops-nix/key.txt` during nixos-anywhere
- `infra/disko/bots01.nix`
  - disk device (`/dev/sda` vs `/dev/vda`)

## Getting required values

### Hetzner API token (HCLOUD_TOKEN)

Create a token in the Hetzner Cloud Console:

- https://console.hetzner.cloud/ → Security → API Tokens

### Admin CIDR (ADMIN_CIDR)

Your public IPv4 CIDR allowed to SSH during bootstrap (typically `<your-ip>/32`).

Example helper:

```bash
curl -4 https://ifconfig.me
```

Then append `/32`.

### GitHub token (GITHUB_TOKEN) (only for private flake repos)

Only needed if `base.flake` points to a private GitHub repo (so the server can fetch it).

Create a fine-grained personal access token:

- https://github.com/settings/personal-access-tokens/new

Recommended settings:

- Repository access: Only select repositories → select your infra repo
- Repository permissions: Contents → Read-only

## Admin sudo password (required)

Goal: after every reinstall, `admin` can `sudo` (password required) while SSH stays key-only.

1) Generate a yescrypt hash locally (no cleartext in git):

```bash
nix shell nixpkgs#mkpasswd -c mkpasswd -m yescrypt
```

2) Store the hash in sops:

```bash
SOPS_AGE_KEY_FILE=.clawdlets/secrets/operators/<you>.agekey EDITOR=vim sops edit .clawdlets/secrets/hosts/bots01.yaml
```

Add:

- `admin_password_hash: '$y$j9T$...'`
- optional: `root_password_hash: '$y$j9T$...'` (also set `enableRootPassword = true` in `infra/nix/hosts/bots01.nix`)

Note: the hash contains `$...`; if you ever paste it into a shell, use single quotes (zsh may treat `$y` as a variable).

To rotate later: update the sops value + redeploy (don’t run `passwd` on-host; `users.mutableUsers = false`).

## 1) Provision + install

```bash
pnpm install
clawdlets stack init
clawdlets secrets init
clawdlets bootstrap
```

`clawdlets` reads `.clawdlets/stack.json` and `.clawdlets/.env` (no `source` needed).

Local dev note (while `clawdlets` is not published): install a local wrapper into `~/bin`:

```bash
just clawdlets-dev-install
clawdlets --help
```

Alternative: `./scripts/bootstrap.sh` (also reads `.env` from repo root).

Note: Terraform in nixpkgs is unfree (bsl11). `clawdlets bootstrap` automatically runs
terraform with `NIXPKGS_ALLOW_UNFREE=1` + `--impure`.

Hetzner SSH key: bootstrap ensures the SSH key exists in your Hetzner account and reuses
it across re-provisions (no "SSH key not unique" failures).

Bootstrap installs with `--build-on-remote` and uses your `origin` on GitHub as the
flake source by default (so the remote builds from source and doesn't need unsigned
local store paths). You can override:

```bash
clawdlets bootstrap --flake github:<owner>/<repo>
```

If the flake repo is private, set `GITHUB_TOKEN` in `.env` (fine-grained PAT scoped to
this repo; Contents: read-only) so the remote can fetch the flake. Public flake repos
need no token.

## 2) Rebuild (pinned)

Use a pinned commit for rebuilds. Short revs are fine; the CLI resolves them to a full SHA.

```bash
just server-rebuild-rev admin@<ipv4> HEAD
# or:
clawdlets server rebuild --target-host admin@<ipv4> --rev HEAD
```

`--rev HEAD` is resolved locally before the remote build.

More deploy/update options (and tradeoffs): `docs/deploy.md`.

Note: GitHub flake fetches are cached by Nix. Bootstrap forces refresh (`tarball-ttl=0`) so new commits
are picked up immediately during iteration.

Note: Even if the upstream flakes declare garnix cache settings in `nixConfig`, Nix may ignore them unless
`accept-flake-config = true`. Bootstrap passes `accept-flake-config=true` and adds the garnix substituter +
public key explicitly to avoid “build from source” surprises during install.

## Server type (Hetzner)

Default is `cx43` (16GB RAM). Reason: bootstrap builds run on the remote and can OOM on small machines
when Node/pnpm-heavy packages are in the closure.

This repo installs `x86_64-linux` NixOS. Use Intel/AMD types (`CX*`, `CPX*`, `CCX*`), not ARM (`CAX*`),
unless you also change the flake system to `aarch64-linux`.

Reference:

- Server types/pricing: https://www.hetzner.com/de/cloud/

## macOS (Determinate Nix): fix “restricted setting / not a trusted user”

If bootstrap fails with warnings like:
- `ignoring the client-specified setting 'require-sigs' ... restricted setting ... not a trusted user`

Then your local `nix-daemon` is refusing restricted settings. Fix once:

1) Edit `nix.custom.conf` (Determinate-managed `nix.conf` is replaced):

```bash
sudo vim /etc/nix/nix.custom.conf
```

Add one:
- `trusted-users = root <your-mac-username>` (tight)
- `trusted-users = root @admin` (all macOS admins)

2) Restart `nix-daemon`:

```bash
sudo launchctl kickstart -k system/org.nixos.nix-daemon
```

If that label doesn’t exist (Determinate often uses a different launchd label), find it then kickstart it:

```bash
sudo launchctl print system | rg -i 'nix-daemon|determinate'
```

Fallback (works even if you can’t find the label): kill the daemon PID and let launchd restart it:

```bash
ps -axo pid,command | rg 'nix-daemon'
sudo kill <pid>
```

With `just`: `just nix-daemon-restart`

3) Verify:

```bash
nix config show | rg -n 'trusted-users'
```

## Troubleshooting: OOM during remote build (exit 137)

If bootstrap fails with `exit code 137` / `Killed` while building `*-pnpm-deps.drv`, the remote builder
ran out of RAM (OOM killer).

Fix (pick one):

- Reduce closure size: don’t enable `"coding-agent"` in `infra/configs/fleet.nix` during bootstrap (it pulls in
  Codex CLI + heavy Node deps).
- Use a bigger Hetzner server type for bootstrap (`SERVER_TYPE=...` in `.env`).
- Add swap on the target (best long-term anyway). If you want swap during install/bootstrap, add a swap
  partition in `infra/disko/bots01.nix` (so it’s available in the installer environment too).

If you have `just` installed:

```bash
just install
just doctor
just bootstrap
just terraform-lockdown
```

Terraform is modularized. Add a second host by instantiating another `bot_host`
module in `infra/terraform/main.tf`.

## Troubleshooting: SSH host key changed after reinstall

Symptoms:

- `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!`
- ssh fails even though port 22 is open

Fix:

```bash
ssh-keygen -R <ipv4>
ssh-keygen -R '[<ipv4>]:22' || true
ssh admin@<ipv4>
```

Note: `clawdlets bootstrap` clears these entries automatically after install.

## 2) Lock down to VPN-only

After WireGuard works:

1) Set `services.clawdbotFleet.bootstrapSsh = false;` in `infra/nix/hosts/bots01.nix`
2) Rebuild over WireGuard:

```bash
nixos-rebuild switch --flake .#bots01 --target-host root@10.44.0.1
```

3) Remove public SSH rule from Hetzner firewall:

```bash
clawdlets infra apply --bootstrap-ssh=false
```

Optional: one-shot helper (rebuild over SSH + terraform apply):

```bash
clawdlets lockdown --target-host admin@10.44.0.1
```

## Optional: Tailscale (recommended)

This repo enables Tailscale on the host (for reliable admin access even if
WireGuard client setup is inconvenient).

On the server (once):

```bash
sudo tailscale up
```

Then SSH over tailnet:

```bash
ssh admin@<tailscale-ip-of-bots01>
```
