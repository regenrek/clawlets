# Secrets (sops + age)

Files:

- `.clawdlets/secrets/.sops.yaml` (recipients + rules)
- `.clawdlets/secrets/hosts/<host>.yaml` (encrypted secrets payload)
- `.clawdlets/secrets/hosts/*.age.pub` (public)
- `.clawdlets/secrets/hosts/*.agekey` (private; never commit)
- `.clawdlets/secrets/operators/*.agekey` (private; never commit)

## Recommended: use the CLI

```bash
clawdlets secrets init
```

This generates:
- host + operator age keys
- `.clawdlets/secrets/.sops.yaml`
- `.clawdlets/extra-files/<host>/var/lib/sops-nix/key.txt`
- `.clawdlets/extra-files/<host>/var/lib/clawdlets/secrets/hosts/<host>.yaml`
- encrypts `.clawdlets/secrets/hosts/<host>.yaml`

Then sync to the host (used by `services.clawdbotFleet.sopsFile` default):

```bash
clawdlets secrets sync --host <host>
```

## Manual steps (if needed)

### 1) Generate host age key

```bash
mkdir -p .clawdlets/secrets/hosts
age-keygen -o .clawdlets/secrets/hosts/bots01.agekey
age-keygen -y .clawdlets/secrets/hosts/bots01.agekey > .clawdlets/secrets/hosts/bots01.age.pub
```

Update `.clawdlets/secrets/.sops.yaml` with the `bots01.age.pub` recipient.

### 2) Edit secrets and encrypt

Edit `.clawdlets/secrets/hosts/bots01.yaml`, then:

```bash
sops -e -i .clawdlets/secrets/hosts/bots01.yaml
```

### 3) nixos-anywhere extra files

Key for first boot:

```bash
mkdir -p .clawdlets/extra-files/bots01/var/lib/sops-nix
cp .clawdlets/secrets/hosts/bots01.agekey .clawdlets/extra-files/bots01/var/lib/sops-nix/key.txt
```

## Common keys

- `wg_private_key`
- `discord_token_<bot>`
- `z_ai_api_key` (Z.AI provider; mapped to ZAI_API_KEY/Z_AI_API_KEY env)

Secret env vars are rendered into `/run/secrets/rendered/clawdbot-<bot>.env` and loaded
via systemd `EnvironmentFile`.

Optional:

- skill secrets referenced by `botProfiles.<bot>.skills.entries.*.envSecrets/*Secret`
- hook secrets referenced by `botProfiles.<bot>.hooks.*Secret`
- GitHub App private key PEM referenced by `botProfiles.<bot>.github.privateKeySecret`
- restic secrets (`restic_password`, optional `restic_env`)
