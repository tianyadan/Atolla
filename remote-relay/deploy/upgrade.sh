#!/usr/bin/env bash
# 一键升级已部署的 remote-relay（保留 /etc/atolla-remote-relay.env）
# 在本机仓库根目录执行；需 SSH 能登录云机。
set -euo pipefail

HOST=""
USER="root"
SSH_PORT="22"
REMOTE_DIR="/opt/atolla-remote-relay"
CHINA_MIRROR=0
FIX_APT=0
ENV_FILE="/etc/atolla-remote-relay.env"

usage() {
  cat <<'EOF'
Usage: upgrade.sh --host HOST [--user USER] [--ssh-port PORT] [--remote-dir DIR]
                  [--china-mirror] [--fix-apt]

  rsync 本仓 remote-relay/ → 远端 → npm ci && build → 保留 env → restart systemd → health

  不需要门禁密码 / 端口：沿用远端 /etc/atolla-remote-relay.env
  若尚未首次部署，请改用 install.sh
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
    --china-mirror) CHINA_MIRROR=1; shift ;;
    --fix-apt) FIX_APT=1; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

[[ -n "$HOST" ]] || usage

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RELAY_SRC="$REPO_ROOT/remote-relay"
[[ -d "$RELAY_SRC" ]] || { echo "remote-relay source not found at $RELAY_SRC" >&2; exit 1; }

CTRL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/atolla-relay-ssh.XXXXXX")"
CTRL_PATH="${CTRL_DIR}/control.sock"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-ssh.sh"
cleanup_ssh() {
  ssh -O exit -o ControlPath="$CTRL_PATH" -p "$SSH_PORT" "${USER}@${HOST}" 2>/dev/null || true
  cleanup_ssh_auth_files
  rm -rf "$CTRL_DIR"
}
trap cleanup_ssh EXIT

SSH_BASE=(
  -p "$SSH_PORT"
  -o ControlMaster=auto
  -o ControlPath="$CTRL_PATH"
  -o ControlPersist=10m
)
setup_ssh_auth
build_ssh_cmd
build_rsync_cmd

if [[ "$CHINA_MIRROR" -eq 1 ]]; then
  echo "==> China mirror enabled (npm registry → npmmirror)"
fi

open_ssh_master

if [[ "$FIX_APT" -eq 1 ]]; then
  echo "==> Force-clear remote apt/dpkg locks (--fix-apt)"
  "${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Need root to clear apt locks (use --user root)" >&2
  exit 1
fi
killall -9 apt-get 2>/dev/null || true
killall -9 apt 2>/dev/null || true
killall -9 dpkg 2>/dev/null || true
killall -9 unattended-upgrade 2>/dev/null || true
sleep 1
rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock \
  /var/lib/apt/lists/lock /var/cache/apt/archives/lock
dpkg --configure -a || true
echo "apt locks cleared"
REMOTE
fi

echo "==> Precheck: existing install + env"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" "$ENV_FILE" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"
ENV_FILE="$2"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — run first-time deploy (install.sh) first." >&2
  exit 1
fi
if [[ ! -d "${REMOTE_DIR}/remote-relay" ]]; then
  echo "Missing ${REMOTE_DIR}/remote-relay — run install.sh first." >&2
  exit 1
fi
if [[ ! -f /etc/systemd/system/atolla-remote-relay.service ]]; then
  echo "Missing systemd unit atolla-remote-relay.service — run install.sh first." >&2
  exit 1
fi
echo "OK: env + unit present"
# show current version if package.json exists
if [[ -f "${REMOTE_DIR}/remote-relay/server/package.json" ]]; then
  grep -E '"version"' "${REMOTE_DIR}/remote-relay/server/package.json" | head -1 || true
fi
REMOTE

echo "==> Sync code to ${USER}@${HOST}:${REMOTE_DIR}/remote-relay"
"${RSYNC[@]}" "$RELAY_SRC/" "${USER}@${HOST}:${REMOTE_DIR}/remote-relay/"

echo "==> Remote npm ci && build (keep env untouched)"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" "$CHINA_MIRROR" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"
CHINA_MIRROR="$2"
export PATH="/usr/local/bin:/usr/bin:$PATH"
cd "${REMOTE_DIR}/remote-relay"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found on remote. Re-run install.sh (or install Node 20+) then upgrade again." >&2
  exit 1
fi

if [[ "$CHINA_MIRROR" == "1" ]]; then
  echo "npm registry → https://registry.npmmirror.com"
  export npm_config_registry="https://registry.npmmirror.com"
  export npm_config_disturl="https://npmmirror.com/mirrors/node"
  export npm_config_nodejs_org_mirror="https://npmmirror.com/mirrors/node"
  export NODEJS_ORG_MIRROR="https://npmmirror.com/mirrors/node"
fi

npm ci
npm run build
echo "Build OK; Node $(node -v) / npm $(npm -v)"
REMOTE

UNIT_LOCAL="$(mktemp)"
sed -e "s|__REMOTE_DIR__|${REMOTE_DIR}|g" \
    "$SCRIPT_DIR/atolla-remote-relay.service" > "$UNIT_LOCAL"

echo "==> Update systemd unit (env file preserved)"
"${RSYNC[@]}" "$UNIT_LOCAL" "${USER}@${HOST}:/tmp/atolla-remote-relay.service"
rm -f "$UNIT_LOCAL"

"${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
if [[ "$(id -u)" -eq 0 ]]; then
  mv /tmp/atolla-remote-relay.service /etc/systemd/system/atolla-remote-relay.service
  systemctl daemon-reload
  systemctl enable atolla-remote-relay.service
  systemctl restart atolla-remote-relay.service
else
  sudo mv /tmp/atolla-remote-relay.service /etc/systemd/system/atolla-remote-relay.service
  sudo systemctl daemon-reload
  sudo systemctl enable atolla-remote-relay.service
  sudo systemctl restart atolla-remote-relay.service
fi
REMOTE

echo "==> Health check (PORT from remote env; wait up to 45s)"
"${SSH[@]}" bash -s -- "$ENV_FILE" <<'REMOTE'
set -euo pipefail
ENV_FILE="$1"
PORT="$(grep -E '^PORT=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '[:space:]')"
PORT="${PORT:-3080}"
URL="http://127.0.0.1:${PORT}/api/health"
echo "Checking ${URL}"
ok=0
body=""
for i in $(seq 1 45); do
  if body="$(curl -sf --max-time 2 "$URL" 2>/dev/null)"; then
    printf '%s\n' "$body" | head -c 500
    echo
    ok=1
    break
  fi
  # 服务可能还在冷启动；偶尔打印 active 状态
  if [[ $((i % 5)) -eq 0 ]]; then
    echo "  … waiting (${i}s), systemd=$(systemctl is-active atolla-remote-relay.service 2>/dev/null || echo unknown)"
  fi
  sleep 1
done
if [[ "$ok" -ne 1 ]]; then
  echo "Health check failed after 45s (curl could not reach ${URL})." >&2
  echo "---- systemctl status ----" >&2
  systemctl status atolla-remote-relay.service --no-pager -l 2>&1 | head -40 >&2 || true
  echo "---- recent journal ----" >&2
  journalctl -u atolla-remote-relay.service -n 50 --no-pager 2>&1 | tail -50 >&2 || true
  exit 7
fi
REMOTE

echo "Upgrade done. SITE_PASSWORD / RELAY_JWT_SECRET / PORT unchanged."
