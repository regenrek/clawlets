#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin_dir="${CLAWLETS_BIN_DIR:-"$HOME/bin"}"
cli_name="clawlets"
typo_name="clawdlets"
wrapper="$bin_dir/$cli_name"
typo_wrapper="$bin_dir/$typo_name"

mkdir -p "$bin_dir"

# Build workspace deps first so cli runtime imports exist in dist/
pnpm -C "$repo_root" -r build >/dev/null

cat >"$wrapper" <<EOF
#!/usr/bin/env bash
set -euo pipefail
node "$repo_root/packages/cli/dist/main.mjs" "\$@"
EOF

chmod +x "$wrapper"
echo "ok: $wrapper"

if [[ -e "$typo_wrapper" ]]; then
  echo "warn: found typo wrapper: $typo_wrapper"
  echo "warn: remove it to avoid confusion: trash \"$typo_wrapper\""
fi

if command -v "$typo_name" >/dev/null 2>&1; then
  echo "warn: '$typo_name' is on PATH (stale typo binary)."
  echo "warn: remove global typo package(s): pnpm remove -g clawdlets clawdlets-workspace"
fi
