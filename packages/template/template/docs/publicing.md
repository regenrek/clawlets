# Going public (safe)

Goal: publish repo without leaking:
- SSH keys / WireGuard peers / IPs / guild IDs
- Tokens (Discord/Hetzner/GitHub/ZAI/etc)
- age keys / sops config

## Rules

- `.clawdlets/` must never be tracked.
- Don’t commit `infra/secrets/**` in the public repo. Use `.clawdlets/` only.
- Keep host-specific values out of `infra/nix/hosts/*.nix` before publishing.

## Recommended process (no history)

1) Create a clean export from this repo:

```bash
mkdir -p /tmp/clawdlets-public
git archive --format=tar HEAD | tar -x -C /tmp/clawdlets-public
cd /tmp/clawdlets-public
git init
git add -A
git commit -m "chore: initial public import"
```

2) Run secret scanners (before pushing):
- gitleaks
- trivy (misconfig/secret checks)

3) Add CI guardrails:
- fail if `.clawdlets/**` is tracked
- fail if any file under `infra/secrets/**` exists

## What users do in public repo

- run `clawdlets stack init` → creates `.clawdlets/`
- run `clawdlets secrets init` → generates local keys + encrypted secrets

