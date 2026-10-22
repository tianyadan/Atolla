#!/usr/bin/env bash
# 停用远端中继守护 timer（unit 归档为 .off，不用 rm）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=watchdog-ssh.sh
source "$SCRIPT_DIR/watchdog-ssh.sh"

HOST=""
USER="root"
SSH_PORT=22

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --remote-dir) shift 2 ;;
    --listen-port) shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$HOST" ]]; then
  echo "usage: $0 --host HOST [--user root] [--ssh-port 22]" >&2
  exit 2
fi

watchdog_ssh_init

echo "==> Disable relay watchdog timer on ${HOST}"
"${SSH[@]}" bash -s <<'EOS'
set -euo pipefail
if [[ $(id -u) -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi
stamp="$(date +%Y%m%d%H%M%S)"
"${SUDO[@]}" systemctl disable --now atolla-relay-watchdog.timer 2>/dev/null || true
"${SUDO[@]}" systemctl stop atolla-relay-watchdog.service 2>/dev/null || true
for f in /etc/systemd/system/atolla-relay-watchdog.timer /etc/systemd/system/atolla-relay-watchdog.service; do
  if [[ -f "$f" ]]; then
    "${SUDO[@]}" mv "$f" "${f}.off.${stamp}"
  fi
done
"${SUDO[@]}" systemctl daemon-reload || true
echo "relay watchdog disabled"
EOS

echo "==> done"
printf '%s\n' '{"enabled":false,"status":"inactive","detail":"已停用 systemd timer","grace_sec":300}'
