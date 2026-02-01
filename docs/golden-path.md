# Golden Path (first-class)

Goal: one boring, cache-only workflow for bootstrap + updates.

## 0) Bootstrap once

```bash
clawdlets secrets init
clawdlets doctor --scope bootstrap
clawdlets bootstrap
```

Optional (image-based bootstrap):

```bash
clawdlets image build --host <host>
clawdlets image upload --host <host> --image-url https://<bucket>/<image>.raw --compression bz2
clawdlets host set --host <host> --hetzner-image <image_id_or_name>
clawdlets bootstrap --mode image
```

After tailnet is up:

```bash
clawdlets host set --target-host admin@<magicdns-or-100.x>
clawdlets host set --ssh-exposure tailnet
clawdlets server update apply --host <host>
clawdlets lockdown
```

## 1) Push changes

Edit config/secrets, commit, push to `main`.

CI (Garnix + GH Actions):
- builds `packages.x86_64-linux.<host>-system`
- computes a signed desired-state release manifest (v1) per host+channel
- publishes manifests to GitHub Pages in the project repo (optional but recommended)
  - requires enabling GitHub Pages (Deploy from branch: `gh-pages` / root)
  - alternative: publish the manifest artifacts to any HTTPS static host

## 2) Apply updates (pull-only)

Hosts apply desired state on a timer (`clawdlets.selfUpdate.interval`).
To apply immediately from your operator machine:

```bash
clawdlets server update apply --host <host> --ssh-tty false
```

To inspect:

```bash
clawdlets server update status --host <host>
clawdlets server update logs --host <host> --since 5m
```

## 3) Promotion (staging → prod)

Promote to prod (manual approval) without rebuild:

- Run workflow `updates: promote` (staging → prod) to publish a prod manifest pointing at an already-built toplevel (new `releaseId`).
- Recommended rollout:
  - Keep a small canary set on `staging` (`hosts.<host>.selfUpdate.channel = "staging"`).
  - Validate `clawdlets server update status|logs` + your health gate on canaries.
  - Promote the exact same `toplevel` to `prod` (new `releaseId`, re-signed).
  - Rollback = publish a new prod manifest (higher `releaseId`) pointing at the previous `toplevel`.

## 4) Enable self-update (host)

```nix
clawdlets.selfUpdate.enable = true;
clawdlets.selfUpdate.baseUrls = [ "https://<pages>/deploy/<host>/prod" ];
clawdlets.selfUpdate.channel = "prod";
clawdlets.selfUpdate.publicKeys = [ "<minisign-pubkey>" ];
```

The host fetches the manifest on a timer and switches by `/nix/store/...` (cache-only).
