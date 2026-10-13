#!/usr/bin/env bash
# 一键将 remote-relay 同步到远端、构建并安装 systemd 服务
set -euo pipefail

HOST=""
USER="root"
SSH_PORT="22"
REMOTE_DIR="/opt/atolla-remote-relay"
LISTEN_PORT="3080"
SITE_PASSWORD=""

usage() {
  cat <<'EOF'
Usage: install.sh --host HOST [--user USER] [--ssh-port PORT] [--remote-dir DIR] --port LISTEN --site-password PASS

  rsync 本仓 remote-relay/ → 远端目录 → npm ci && npm run build → systemd → curl /api/health
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
    --port) LISTEN_PORT="$2"; shift 2 ;;
    --site-password) SITE_PASSWORD="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

[[ -n "$HOST" ]] || usage
[[ -n "$SITE_PASSWORD" ]] || usage

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RELAY_SRC="$REPO_ROOT/remote-relay"
[[ -d "$RELAY_SRC" ]] || { echo "remote-relay source not found at $RELAY_SRC" >&2; exit 1; }

SSH=(ssh -p "$SSH_PORT" "${USER}@${HOST}")
RSYNC=(rsync -az --delete
  --exclude node_modules
  --exclude server/data
  --exclude 'server/dist'
  --exclude web/dist
  -e "ssh -p ${SSH_PORT}"
)

JWT_SECRET="$(openssl rand -hex 32)"

echo "==> Sync to ${USER}@${HOST}:${REMOTE_DIR}/remote-relay"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"
mkdir -p "${REMOTE_DIR}/remote-relay"
REMOTE
"${RSYNC[@]}" "$RELAY_SRC/" "${USER}@${HOST}:${REMOTE_DIR}/remote-relay/"

echo "==> Remote npm ci && build"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"
cd "${REMOTE_DIR}/remote-relay"
if ! command -v npm >/dev/null 2>&1; then
  echo 'npm not found on remote host' >&2
  exit 1
fi
npm ci
npm run build
REMOTE

UNIT_LOCAL="$(mktemp)"
sed -e "s|__REMOTE_DIR__|${REMOTE_DIR}|g" \
    "$SCRIPT_DIR/atolla-remote-relay.service" > "$UNIT_LOCAL"

echo "==> Write /etc/atolla-remote-relay.env and systemd unit"
"${SSH[@]}" bash -s -- "$LISTEN_PORT" "$SITE_PASSWORD" "$JWT_SECRET" <<'REMOTE'
set -euo pipefail
LISTEN_PORT="$1"
SITE_PASSWORD="$2"
JWT_SECRET="$3"
ENV_FILE="/etc/atolla-remote-relay.env"
umask 077
sudo tee "$ENV_FILE" >/dev/null <<EOF
NODE_ENV=production
PORT=$(printf '%s' "$LISTEN_PORT")
SITE_PASSWORD=$(printf '%s' "$SITE_PASSWORD")
RELAY_JWT_SECRET=$(printf '%s' "$JWT_SECRET")
EOF
sudo chmod 600 "$ENV_FILE"
REMOTE

echo "==> Install systemd unit atolla-remote-relay.service"
"${RSYNC[@]}" "$UNIT_LOCAL" "${USER}@${HOST}:/tmp/atolla-remote-relay.service"
rm -f "$UNIT_LOCAL"

"${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
sudo mv /tmp/atolla-remote-relay.service /etc/systemd/system/atolla-remote-relay.service
sudo systemctl daemon-reload
sudo systemctl enable atolla-remote-relay.service
sudo systemctl restart atolla-remote-relay.service
REMOTE

echo "==> Health check http://127.0.0.1:${LISTEN_PORT}/api/health on remote"
"${SSH[@]}" "curl -sf \"http://127.0.0.1:${LISTEN_PORT}/api/health\" | head -c 500"
echo
echo "Done. Point admin Base URL to your public URL for port ${LISTEN_PORT}."
