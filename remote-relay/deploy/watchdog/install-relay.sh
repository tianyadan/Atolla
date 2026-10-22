#!/usr/bin/env bash
# 在远端安装并启用中继守护 timer（与主服务 unit 分离）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=watchdog-ssh.sh
source "$SCRIPT_DIR/watchdog-ssh.sh"

HOST=""
USER="root"
SSH_PORT=22
REMOTE_DIR="/opt/atolla-remote-relay"
LISTEN_PORT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
    --listen-port) LISTEN_PORT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$HOST" ]]; then
  echo "usage: $0 --host HOST [--user root] [--ssh-port 22] [--remote-dir /opt/atolla-remote-relay]" >&2
  exit 2
fi

watchdog_ssh_init

echo "==> Ensure remote watchdog scripts under ${REMOTE_DIR}"
# 仅同步 watchdog 目录，不用 --delete
RSYNC_W=(rsync -az)
if [[ ${#SSH_PREFIX[@]} -gt 0 ]]; then
  RSYNC_W+=(-e "${SSH_PREFIX[*]} ssh ${SSH_BASE[*]}")
else
  RSYNC_W+=(-e "ssh ${SSH_BASE[*]}")
fi
"${RSYNC_W[@]}" "$SCRIPT_DIR/" "${USER}@${HOST}:${REMOTE_DIR}/remote-relay/deploy/watchdog/"

REMOTE_SVC="${WATCHDOG_CTRL_DIR}/atolla-relay-watchdog.service"
REMOTE_TIMER="${WATCHDOG_CTRL_DIR}/atolla-relay-watchdog.timer"
sed "s|__REMOTE_DIR__|${REMOTE_DIR}|g" "$SCRIPT_DIR/atolla-relay-watchdog.service" >"$REMOTE_SVC"
cp "$SCRIPT_DIR/atolla-relay-watchdog.timer" "$REMOTE_TIMER"

"${SSH[@]}" "mkdir -p '${REMOTE_DIR}/remote-relay/deploy/watchdog' /var/lib/atolla-relay-watchdog"
"${RSYNC_W[@]}" "$REMOTE_SVC" "${USER}@${HOST}:/tmp/atolla-relay-watchdog.service"
"${RSYNC_W[@]}" "$REMOTE_TIMER" "${USER}@${HOST}:/tmp/atolla-relay-watchdog.timer"

echo "==> Install systemd timer on remote"
"${SSH[@]}" env REMOTE_DIR="$REMOTE_DIR" bash -s <<'EOS'
set -euo pipefail
if [[ $(id -u) -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi
"${SUDO[@]}" mv /tmp/atolla-relay-watchdog.service /etc/systemd/system/atolla-relay-watchdog.service
"${SUDO[@]}" mv /tmp/atolla-relay-watchdog.timer /etc/systemd/system/atolla-relay-watchdog.timer
CHECK="${REMOTE_DIR}/remote-relay/deploy/watchdog/relay-check.sh"
"${SUDO[@]}" chmod +x "$CHECK" 2>/dev/null || chmod +x "$CHECK" || true
"${SUDO[@]}" systemctl daemon-reload
"${SUDO[@]}" systemctl enable --now atolla-relay-watchdog.timer
"${SUDO[@]}" systemctl start atolla-relay-watchdog.service || true
systemctl is-active atolla-relay-watchdog.timer
EOS

if [[ -n "${LISTEN_PORT:-}" ]]; then
  echo "==> note: health port from /etc/atolla-remote-relay.env (hint=${LISTEN_PORT})"
fi

echo "==> relay watchdog enabled (grace=300s, interval≈60s)"
printf '%s\n' '{"enabled":true,"status":"active","detail":"已安装并启用 systemd timer","grace_sec":300}'
