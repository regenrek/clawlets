#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

NIX_BIN="${NIX_BIN:-/nix/var/nix/profiles/default/bin/nix}"

load_dotenv() {
  local dotenv_file="$1"

  if [ ! -f "${dotenv_file}" ]; then
    return 0
  fi

  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      "" | \#*) continue ;;
    esac

    if [[ "${line}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      local key="${line%%=*}"
      local value="${line#*=}"
      value="${value%$'\r'}"

      if [[ "${value}" =~ ^\".*\"$ ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "${value}" =~ ^\'.*\'$ ]]; then
        value="${value:1:${#value}-2}"
      fi

      if [ -z "${!key:-}" ]; then
        export "${key}=${value}"
      fi
    fi
  done <"${dotenv_file}"
}

load_dotenv "${repo_root}/.env"

: "${HCLOUD_TOKEN:?set HCLOUD_TOKEN}"
: "${ADMIN_CIDR:?set ADMIN_CIDR (your.ip.addr/32)}"
: "${SSH_PUBKEY_FILE:?set SSH_PUBKEY_FILE (path to your .pub)}"

if [ ! -f "${SSH_PUBKEY_FILE}" ]; then
  echo "SSH public key not found: ${SSH_PUBKEY_FILE}" >&2
  exit 1
fi

try_get_origin_flake() {
  local origin
  origin="$(git remote get-url origin 2>/dev/null || true)"

  if [[ "${origin}" =~ ^git@github\.com:([^/]+)/([^/]+?)(\.git)?$ ]]; then
    printf 'github:%s/%s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return 0
  fi

  if [[ "${origin}" =~ ^https://github\.com/([^/]+)/([^/]+?)(\.git)?$ ]]; then
    printf 'github:%s/%s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return 0
  fi

  return 1
}

github_repo_public_check() {
  local owner="$1"
  local repo="$2"
  local code

  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H 'User-Agent: clawdlets-bootstrap' \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/${owner}/${repo}" || true)"

  printf '%s' "${code}"
}

ensure_hcloud_ssh_key_id() {
  local name="$1"
  local public_key="$2"

  local list_json
  list_json="$(curl -fsSL \
    -H "Authorization: Bearer ${HCLOUD_TOKEN}" \
    "https://api.hetzner.cloud/v1/ssh_keys")"

  local existing_id
  existing_id="$(python3 - <<'PY' "${public_key}" "${list_json}"
import json, sys
pub = sys.argv[1].strip()
data = json.loads(sys.argv[2])
for k in data.get("ssh_keys", []):
  if (k.get("public_key","").strip() == pub):
    print(k.get("id"))
    break
PY
)"

  if [ -n "${existing_id}" ]; then
    printf '%s' "${existing_id}"
    return 0
  fi

  local create_json
  create_json="$(curl -fsSL \
    -H "Authorization: Bearer ${HCLOUD_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${name}\",\"public_key\":$(python3 - <<'PY' "${public_key}"
import json, sys
print(json.dumps(sys.argv[1]))
PY
)}" \
    "https://api.hetzner.cloud/v1/ssh_keys" || true)"

  local created_id
  created_id="$(python3 - <<'PY' "${create_json}"
import json, sys
try:
  data = json.loads(sys.argv[1] or "{}")
  key = data.get("ssh_key") or {}
  if key.get("id"):
    print(key["id"])
except Exception:
  pass
PY
)"

  if [ -n "${created_id}" ]; then
    printf '%s' "${created_id}"
    return 0
  fi

  # If create failed due to uniqueness, re-list and return the id.
  list_json="$(curl -fsSL \
    -H "Authorization: Bearer ${HCLOUD_TOKEN}" \
    "https://api.hetzner.cloud/v1/ssh_keys")"
  existing_id="$(python3 - <<'PY' "${public_key}" "${list_json}"
import json, sys
pub = sys.argv[1].strip()
data = json.loads(sys.argv[2])
for k in data.get("ssh_keys", []):
  if (k.get("public_key","").strip() == pub):
    print(k.get("id"))
    break
PY
)"

  if [ -z "${existing_id}" ]; then
    echo "Failed to ensure Hetzner SSH key exists (clawdbot-admin)" >&2
    exit 1
  fi

  printf '%s' "${existing_id}"
}

tf_server_type_var=()
if [ -n "${SERVER_TYPE:-}" ]; then
  tf_server_type_var=(-var "server_type=${SERVER_TYPE}")
fi

SSH_PUBLIC_KEY="$(cat "${SSH_PUBKEY_FILE}")"
SSH_KEY_HASH="$(printf '%s' "${SSH_PUBLIC_KEY}" | shasum -a 256 | awk '{print $1}' | cut -c1-10)"
SSH_KEY_NAME="clawdbot-admin-${SSH_KEY_HASH}"
SSH_KEY_ID="$(ensure_hcloud_ssh_key_id "${SSH_KEY_NAME}" "${SSH_PUBLIC_KEY}")"

pushd infra/terraform >/dev/null
terraform init -input=false
terraform apply -auto-approve \
  -input=false \
  -var "hcloud_token=${HCLOUD_TOKEN}" \
  -var "admin_cidr=${ADMIN_CIDR}" \
  -var "ssh_key_id=${SSH_KEY_ID}" \
  -var "bootstrap_ssh=true" \
  "${tf_server_type_var[@]}"

IPV4="$(terraform output -raw ipv4)"
popd >/dev/null

echo "Target IPv4: ${IPV4}"

ssh-keygen -R "${IPV4}" >/dev/null 2>&1 || true
ssh-keygen -R "[${IPV4}]:22" >/dev/null 2>&1 || true

FLAKE_BASE="${BOOTSTRAP_FLAKE:-}"
if [ -z "${FLAKE_BASE}" ]; then
  if FLAKE_BASE="$(try_get_origin_flake)"; then
    :
  else
    FLAKE_BASE="."
  fi
fi

if [[ "${FLAKE_BASE}" =~ ^github:([^/]+)/([^/]+)(/.*)?$ ]]; then
  GH_OWNER="${BASH_REMATCH[1]}"
  GH_REPO="${BASH_REMATCH[2]}"

  if [ -z "${GITHUB_TOKEN:-}" ]; then
    code="$(github_repo_public_check "${GH_OWNER}" "${GH_REPO}")"
    if [ "${code}" = "404" ]; then
      echo "GitHub repo ${GH_OWNER}/${GH_REPO} appears private (404 without auth). Set GITHUB_TOKEN in .env (fine-grained PAT scoped to this repo; Contents: read-only)." >&2
      exit 1
    fi
    if [ "${code}" = "403" ]; then
      echo "warn: GitHub API rate-limited while checking ${GH_OWNER}/${GH_REPO}; continuing without preflight" >&2
    fi
  fi
fi

github_token_opt=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  github_token_opt=(--option access-tokens "github.com=${GITHUB_TOKEN}")
fi

"${NIX_BIN}" run \
  --option max-jobs 1 \
  --option cores 1 \
  --option keep-outputs false \
  --option keep-derivations false \
  --option require-sigs false \
  github:nix-community/nixos-anywhere -- \
  --option tarball-ttl 0 \
  --option accept-flake-config true \
  --option extra-substituters https://cache.garnix.io \
  --option extra-trusted-public-keys cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g= \
  --build-on-remote \
  --extra-files ./infra/secrets/extra-files/bots01 \
  "${github_token_opt[@]}" \
  --ssh-store-setting require-sigs false \
  --flake "${FLAKE_BASE}#bots01" \
  root@"${IPV4}"

ssh-keygen -R "${IPV4}" >/dev/null 2>&1 || true
ssh-keygen -R "[${IPV4}]:22" >/dev/null 2>&1 || true

echo
printf '%s
' \
  "Installed." \
  "SSH host key cache cleared: ssh admin@${IPV4}" \
  "Next:" \
  "1) Bring up WireGuard on your machine (peer 10.44.0.2)." \
  "2) Set services.clawdbotFleet.bootstrapSsh = false; in infra/nix/hosts/bots01.nix and rebuild." \
  "3) Re-apply terraform with bootstrap_ssh=false to remove public SSH."
