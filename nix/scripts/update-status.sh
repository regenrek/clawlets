#!/usr/bin/env bash
set -euo pipefail

state_dir="${CLAWDLETS_UPDATER_STATE_DIR:-/var/lib/clawdlets/updates}"

status="${state_dir}/status.json"
current="${state_dir}/current.json"
previous="${state_dir}/previous.json"

if [[ -f "${status}" ]]; then
  cat "${status}"
  exit 0
fi

echo "{"
echo "  \"status\": \"missing\","
echo "  \"stateDir\": \"${state_dir}\","
echo "  \"current\": $(if [[ -f \"${current}\" ]]; then echo true; else echo false; fi),"
echo "  \"previous\": $(if [[ -f \"${previous}\" ]]; then echo true; else echo false; fi)"
echo "}"

