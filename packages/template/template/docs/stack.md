# Stack (`.clawdlets/stack.json`)

`clawdlets` reads one local stack directory (default: `.clawdlets/`).

This is the only place that should contain instance-specific details like target hosts, CIDRs, and secret paths.

## Files

- `.clawdlets/stack.json`: stack config (validated)
- `.clawdlets/.env`: tokens (Hetzner, optional GitHub)
- `.clawdlets/dist/stack.schema.json`: generated JSON Schema for editor autocomplete

## Schema

Top-level:

- `schemaVersion`: currently `1`
- `base.flake` (optional): base flake URI (usually `github:<owner>/<repo>`). If unset, `clawdlets` tries to infer it from `git remote origin`.
- `envFile`: relative to `.clawdlets/` (default `.env`)
- `hosts.<name>`: host entries keyed by stack host name

Host entry (`hosts.<name>`):

- `flakeHost`: nixosConfiguration name (often same as host key)
- `targetHost`: SSH target (e.g. `botsmj` or `admin@100.x`)
- `hetzner.serverType`: e.g. `cx43`
- `terraform.adminCidr`: CIDR allowed for bootstrap SSH rule (e.g. `203.0.113.10/32`)
- `terraform.sshPubkeyFile`: local path to `.pub`
- `secrets.localFile`: relative to `.clawdlets/` (encrypted sops YAML)
- `secrets.remoteFile`: absolute path on server (used by Nix module default)

## Example

```json
{
  "schemaVersion": 1,
  "envFile": ".env",
  "hosts": {
    "bots01": {
      "flakeHost": "bots01",
      "targetHost": "botsmj",
      "hetzner": { "serverType": "cx43" },
      "terraform": {
        "adminCidr": "203.0.113.10/32",
        "sshPubkeyFile": "~/.ssh/id_ed25519.pub"
      },
      "secrets": {
        "localFile": "secrets/hosts/bots01.yaml",
        "remoteFile": "/var/lib/clawdlets/secrets/hosts/bots01.yaml"
      }
    }
  }
}
```
