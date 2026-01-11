#!/usr/bin/env bash
set -euo pipefail

ws="${CLAWDLETS_WORKSPACE_DIR:-}"
seed_dir="${CLAWDLETS_SEED_DIR:-}"
tools_md="${CLAWDLETS_TOOLS_MD:-/etc/clawdlets/tools.md}"

if [[ -z "${ws}" || -z "${seed_dir}" ]]; then
  echo "error: CLAWDLETS_WORKSPACE_DIR and CLAWDLETS_SEED_DIR must be set" >&2
  exit 2
fi

if [[ ! -d "${ws}" ]]; then
  echo "error: workspace dir missing: ${ws}" >&2
  exit 2
fi

if [[ ! -d "${seed_dir}" ]]; then
  echo "error: seed dir missing: ${seed_dir}" >&2
  exit 2
fi

if find "${ws}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
  exit 0
fi

cp -a "${seed_dir}/." "${ws}/"

if [[ -f "${ws}/TOOLS.md" && -r "${tools_md}" ]]; then
  if ! grep -q 'clawdlets-tools:begin' "${ws}/TOOLS.md"; then
    {
      printf '\n<!-- clawdlets-tools:begin -->\n'
      cat "${tools_md}"
      printf '\n<!-- clawdlets-tools:end -->\n'
    } >>"${ws}/TOOLS.md"
  fi
fi

