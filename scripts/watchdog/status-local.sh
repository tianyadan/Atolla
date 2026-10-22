#!/usr/bin/env bash
# 输出本机守护状态 JSON（供后端 API 调用）。
set -euo pipefail

LABEL="com.atolla.backend-watchdog"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"
enabled=false
status="inactive"
detail="未安装"

json_escape() {
  # shellcheck disable=SC2001
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

if [ -f "$PLIST" ]; then
  if launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1 \
    || launchctl list "$LABEL" >/dev/null 2>&1; then
    enabled=true
    status="active"
    detail="LaunchAgent 已加载"
  else
    enabled=false
    status="inactive"
    detail="plist 存在但未加载"
  fi
fi

printf '{"enabled":%s,"status":"%s","detail":"%s","grace_sec":180}\n' \
  "$enabled" "$(json_escape "$status")" "$(json_escape "$detail")"
