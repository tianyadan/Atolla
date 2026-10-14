#!/usr/bin/env bash
# 一键将 remote-relay 同步到远端、构建并安装 systemd 服务
# - 远端无 Node/npm 时自动安装 Node.js 20 LTS
# - 安装 better-sqlite3 所需编译工具
# - SSH ControlMaster 复用连接，减少反复输入密码
# - 可选 --china-mirror：Node/npm 走国内镜像（默认关闭）
set -euo pipefail

HOST=""
USER="root"
SSH_PORT="22"
REMOTE_DIR="/opt/atolla-remote-relay"
LISTEN_PORT="3080"
SITE_PASSWORD=""
NODE_MAJOR="${NODE_MAJOR:-20}"
CHINA_MIRROR=0
FIX_APT=0

usage() {
  cat <<'EOF'
Usage: install.sh --host HOST [--user USER] [--ssh-port PORT] [--remote-dir DIR]
                  --port LISTEN --site-password PASS [--china-mirror] [--fix-apt]

  rsync 本仓 remote-relay/ → 远端目录
  →（如需）安装 Node.js 20 + build tools
  → npm ci && npm run build → systemd → curl /api/health

Options:
  --china-mirror   使用国内镜像加速（npmmirror Node 二进制 + npm registry）
                   默认不加则走官方 NodeSource / npmjs
  --fix-apt        先强清远端卡住的 apt/dpkg 锁再继续部署

Environment:
  NODE_MAJOR   Node major version to install if missing (default: 20)
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
    --china-mirror) CHINA_MIRROR=1; shift ;;
    --fix-apt) FIX_APT=1; shift ;;
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

# shellcheck source=lib-ssh.sh
# SSH multiplexing + optional password (ATOLLA_SSH_PASSWORD) / key BatchMode
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
  echo "==> China mirror enabled (npmmirror for Node binary + npm registry)"
fi

open_ssh_master

JWT_SECRET="$(openssl rand -hex 32)"

if [[ "$FIX_APT" -eq 1 ]]; then
  echo "==> Force-clear remote apt/dpkg locks (--fix-apt)"
  "${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Need root to clear apt locks (use --user root)" >&2
  exit 1
fi
# kill by name; ignore "no process" errors
killall -9 apt-get 2>/dev/null || true
killall -9 apt 2>/dev/null || true
killall -9 dpkg 2>/dev/null || true
killall -9 unattended-upgrade 2>/dev/null || true
sleep 1
rm -f /var/lib/dpkg/lock-frontend \
  /var/lib/dpkg/lock \
  /var/lib/apt/lists/lock \
  /var/cache/apt/archives/lock
dpkg --configure -a || true
echo "apt locks cleared"
REMOTE
fi

echo "==> Sync to ${USER}@${HOST}:${REMOTE_DIR}/remote-relay"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"
mkdir -p "${REMOTE_DIR}/remote-relay"
REMOTE
"${RSYNC[@]}" "$RELAY_SRC/" "${USER}@${HOST}:${REMOTE_DIR}/remote-relay/"

echo "==> Ensure Node.js ${NODE_MAJOR}+ and build tools on remote"
"${SSH[@]}" bash -s -- "$NODE_MAJOR" "$CHINA_MIRROR" <<'REMOTE'
set -euo pipefail
NODE_MAJOR="$1"
CHINA_MIRROR="$2"

# Run as root. Do NOT pass VAR=value as argv — bash treats that as a command name.
as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

# Pipe stdin into bash as root (NodeSource setup scripts).
pipe_as_root_bash() {
  if [[ "$(id -u)" -eq 0 ]]; then
    bash -
  else
    sudo -E bash -
  fi
}

node_ok() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || return 1
  local major
  major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  [[ "$major" -ge "$NODE_MAJOR" ]]
}

# Wait for apt/dpkg lock; after timeout kill leftover apt from a prior interrupted deploy.
wait_apt_lock() {
  local max_wait="${1:-180}"
  local waited=0
  while as_root fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
    || as_root fuser /var/lib/dpkg/lock >/dev/null 2>&1 \
    || as_root fuser /var/lib/apt/lists/lock >/dev/null 2>&1 \
    || as_root fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
    if [[ "$waited" -ge "$max_wait" ]]; then
      echo "apt lock still held after ${max_wait}s — stopping stale apt/dpkg processes..."
      as_root killall -9 apt-get 2>/dev/null || true
      as_root killall -9 apt 2>/dev/null || true
      as_root killall -9 dpkg 2>/dev/null || true
      as_root killall -9 unattended-upgrade 2>/dev/null || true
      sleep 2
      as_root rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock \
        /var/lib/apt/lists/lock /var/cache/apt/archives/lock
      as_root dpkg --configure -a || true
      break
    fi
    if (( waited % 15 == 0 )); then
      echo "Waiting for apt/dpkg lock... (${waited}s / ${max_wait}s)"
    fi
    sleep 3
    waited=$((waited + 3))
  done
}

apt_update() {
  wait_apt_lock 180
  as_root apt-get update -y
}

apt_install() {
  wait_apt_lock 180
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

# Drop NodeSource apt repo (slow abroad / leftover from failed installs).
disable_nodesource_apt() {
  as_root rm -f /etc/apt/sources.list.d/nodesource*.list \
    /etc/apt/sources.list.d/nodesource*.sources 2>/dev/null || true
}

install_build_tools_apt() {
  if [[ "$CHINA_MIRROR" == "1" ]]; then
    disable_nodesource_apt
  fi
  apt_update
  apt_install ca-certificates curl gnupg build-essential python3 xz-utils
}

install_build_tools_dnf() {
  as_root dnf install -y curl ca-certificates gcc-c++ make python3 xz
}

install_build_tools_yum() {
  as_root yum install -y curl ca-certificates gcc-c++ make python3 xz
}

install_build_tools() {
  if command -v apt-get >/dev/null 2>&1; then
    install_build_tools_apt
  elif command -v dnf >/dev/null 2>&1; then
    install_build_tools_dnf
  elif command -v yum >/dev/null 2>&1; then
    install_build_tools_yum
  fi
}

# Resolve linux arch for Node binary tarball
node_linux_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo x64 ;;
    aarch64|arm64) echo arm64 ;;
    armv7l) echo armv7l ;;
    *) echo "" ;;
  esac
}

# Pick latest v${NODE_MAJOR} from npmmirror index.json (fallback fixed patch)
resolve_node_version_china() {
  local ver=""
  if command -v python3 >/dev/null 2>&1; then
    ver="$(
      curl -fsSL --connect-timeout 15 --max-time 60 \
        "https://npmmirror.com/mirrors/node/index.json" \
        | python3 -c "
import json,sys
major=int('${NODE_MAJOR}')
data=json.load(sys.stdin)
# prefer current LTS in this major, else highest version
best=None
lts=None
for row in data:
    v=str(row.get('version') or '').lstrip('v')
    parts=v.split('.')
    if len(parts)<1 or not parts[0].isdigit() or int(parts[0])!=major:
        continue
    if row.get('lts') and not lts:
        lts=v
    if best is None or tuple(int(x) for x in v.split('.')[:3]) > tuple(int(x) for x in best.split('.')[:3]):
        best=v
print(lts or best or '')
" 2>/dev/null || true
    )"
  fi
  if [[ -z "$ver" ]]; then
    ver="${NODE_MAJOR}.18.0"
  fi
  echo "$ver"
}

# Install Node from npmmirror tarball into /usr/local (fast in CN)
install_node_china_tarball() {
  install_build_tools
  local arch ver url tmp
  arch="$(node_linux_arch)"
  if [[ -z "$arch" ]]; then
    echo "Unsupported CPU arch for Node tarball: $(uname -m)" >&2
    exit 1
  fi
  ver="$(resolve_node_version_china)"
  url="https://npmmirror.com/mirrors/node/v${ver}/node-v${ver}-linux-${arch}.tar.xz"
  echo "Downloading Node v${ver} from npmmirror..."
  echo "  $url"
  tmp="$(mktemp /tmp/node-XXXXXX.tar.xz)"
  curl -fL --connect-timeout 20 --retry 3 --retry-delay 2 -o "$tmp" "$url"
  as_root tar -xJf "$tmp" -C /usr/local --strip-components=1
  rm -f "$tmp"
  hash -r || true
}

install_node_apt() {
  install_build_tools_apt
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | pipe_as_root_bash
  apt_install nodejs
}

install_node_dnf() {
  install_build_tools_dnf
  curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | pipe_as_root_bash
  as_root dnf install -y nodejs
}

install_node_yum() {
  install_build_tools_yum
  curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | pipe_as_root_bash
  as_root yum install -y nodejs
}

# Clear leftover apt from interrupted NodeSource installs before doing anything else.
if command -v apt-get >/dev/null 2>&1; then
  wait_apt_lock 60
  if [[ "$CHINA_MIRROR" == "1" ]]; then
    disable_nodesource_apt
  fi
fi

if node_ok; then
  echo "Node $(node -v) / npm $(npm -v) already OK"
else
  echo "Installing Node.js ${NODE_MAJOR}.x (npm missing or too old)..."
  if [[ "$CHINA_MIRROR" == "1" ]]; then
    install_node_china_tarball
  elif command -v apt-get >/dev/null 2>&1; then
    install_node_apt
  elif command -v dnf >/dev/null 2>&1; then
    install_node_dnf
  elif command -v yum >/dev/null 2>&1; then
    install_node_yum
  else
    echo "Unsupported remote OS: need apt, dnf, or yum (or use --china-mirror tarball)." >&2
    echo "Install Node.js ${NODE_MAJOR}+ manually, then re-run this script." >&2
    exit 1
  fi
  install_build_tools
fi

hash -r || true
export PATH="/usr/local/bin:/usr/bin:$PATH"
if ! node_ok; then
  echo "Node/npm still missing after install. PATH=$(command -v node || true) $(command -v npm || true)" >&2
  exit 1
fi
echo "Using Node $(node -v) / npm $(npm -v)"
REMOTE

echo "==> Remote npm ci && build"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" "$CHINA_MIRROR" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"
CHINA_MIRROR="$2"
cd "${REMOTE_DIR}/remote-relay"
export PATH="/usr/local/bin:/usr/bin:$PATH"

if [[ "$CHINA_MIRROR" == "1" ]]; then
  echo "npm registry → https://registry.npmmirror.com"
  export npm_config_registry="https://registry.npmmirror.com"
  # node-gyp / prebuild binary mirrors
  export npm_config_disturl="https://npmmirror.com/mirrors/node"
  export npm_config_nodejs_org_mirror="https://npmmirror.com/mirrors/node"
  export NODEJS_ORG_MIRROR="https://npmmirror.com/mirrors/node"
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

# 保留已有 JWT，避免每次重部署踢掉已登录手机端
if [[ -f "$ENV_FILE" ]]; then
  OLD_JWT="$(grep -E '^RELAY_JWT_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  if [[ -n "${OLD_JWT:-}" ]]; then
    JWT_SECRET="$OLD_JWT"
    echo "Reusing existing RELAY_JWT_SECRET"
  fi
fi

umask 077
if [[ "$(id -u)" -eq 0 ]]; then
  tee "$ENV_FILE" >/dev/null <<EOF
NODE_ENV=production
PORT=$(printf '%s' "$LISTEN_PORT")
SITE_PASSWORD=$(printf '%s' "$SITE_PASSWORD")
RELAY_JWT_SECRET=$(printf '%s' "$JWT_SECRET")
EOF
  chmod 600 "$ENV_FILE"
else
  sudo tee "$ENV_FILE" >/dev/null <<EOF
NODE_ENV=production
PORT=$(printf '%s' "$LISTEN_PORT")
SITE_PASSWORD=$(printf '%s' "$SITE_PASSWORD")
RELAY_JWT_SECRET=$(printf '%s' "$JWT_SECRET")
EOF
  sudo chmod 600 "$ENV_FILE"
fi
REMOTE

echo "==> Install systemd unit atolla-remote-relay.service"
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

echo "==> Health check http://127.0.0.1:${LISTEN_PORT}/api/health on remote (wait up to 45s)"
"${SSH[@]}" bash -s -- "$LISTEN_PORT" <<'REMOTE'
set -euo pipefail
PORT="$1"
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
echo
echo "Done. Point admin Base URL to your public URL for port ${LISTEN_PORT}."
echo "Tip: open security group / firewall for TCP ${LISTEN_PORT}."
