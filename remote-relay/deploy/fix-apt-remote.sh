#!/usr/bin/env bash
# 清掉远端卡住的 apt/dpkg 锁（不要手贴长 SSH 一行命令）
# Usage: ./remote-relay/deploy/fix-apt-remote.sh --host IP [--user root] [--ssh-port 22]
set -euo pipefail

HOST=""
USER="root"
SSH_PORT="22"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 --host IP [--user root] [--ssh-port 22]"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$HOST" ]] || { echo "Need --host" >&2; exit 1; }

echo "==> Clearing apt locks on ${USER}@${HOST}"
ssh -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new "${USER}@${HOST}" bash -s <<'EOS'
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Must SSH as root" >&2
  exit 1
fi
killall -9 apt-get 2>/dev/null || true
killall -9 apt 2>/dev/null || true
killall -9 dpkg 2>/dev/null || true
killall -9 unattended-upgrade 2>/dev/null || true
sleep 1
rm -f /var/lib/dpkg/lock-frontend
rm -f /var/lib/dpkg/lock
rm -f /var/lib/apt/lists/lock
rm -f /var/cache/apt/archives/lock
dpkg --configure -a || true
echo "OK: apt locks cleared"
EOS
