#!/usr/bin/env bash
# 探测远端中继守护是否启用，输出 JSON。
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

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

emit() {
  local enabled="$1" status="$2" detail="$3"
  printf '{"enabled":%s,"status":"%s","detail":"%s","grace_sec":300}\n' \
    "$enabled" "$(json_escape "$status")" "$(json_escape "$detail")"
}

if [[ -z "$HOST" ]]; then
  emit false unknown "缺少 host"
  exit 0
fi

if ! watchdog_ssh_init; then
  ec=$?
  if [[ -n "${ATOLLA_SSH_PASSWORD:-}" ]]; then
    emit false error "SSH 失败(exit ${ec})：密码认证未成功，请确认密码或安装 sshpass"
  else
    emit false error "SSH 失败(exit ${ec})：未提供密码且密钥不可用，请在设置里填写 SSH 密码后重试"
  fi
  exit 0
fi

out="$("${SSH[@]}" "systemctl is-active atolla-relay-watchdog.timer 2>/dev/null || echo inactive" || true)"
out="$(printf '%s' "$out" | tr -d '\r' | head -1)"

if [[ "$out" == "active" ]]; then
  emit true active "systemd timer 已启用"
else
  emit false inactive "timer 状态: ${out:-unknown}"
fi
