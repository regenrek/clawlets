# CLI (`clawdlets`)

Canonical source: `clawdlets --help`.

## Core workflow

- project scaffold: `clawdlets project init --dir ./clawdlets-myproject`
- init stack: `clawdlets stack init`
- init secrets: `clawdlets secrets init`
- validate: `clawdlets doctor`
- bootstrap: `clawdlets bootstrap`
- lockdown: `clawdlets lockdown --target-host admin@<tailscale-ip>`

## Server ops

- status: `clawdlets server status --target-host <host>`
- logs: `clawdlets server logs --target-host <host> --unit clawdbot-melinda.service --since 10m --follow`
- restart: `clawdlets server restart --target-host <host> --unit clawdbot-melinda.service`
- rebuild pinned: `clawdlets server rebuild --target-host <host> --rev HEAD`

## Infra ops

- terraform apply: `clawdlets infra apply --bootstrap-ssh=true`
- terraform lockdown: `clawdlets infra apply --bootstrap-ssh=false`

## Justfile shortcuts

Run `just --list`.
