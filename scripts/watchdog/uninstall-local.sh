#!/usr/bin/env bash
# 停用本机 LaunchAgent 后端守护（不用 rm：plist 挪到 .off 后缀）。
set -euo pipefail

LABEL="com.atolla.backend-watchdog"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST="${PLIST_DIR}/${LABEL}.plist"
UID_NUM="$(id -u)"

if launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
elif [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
fi

if [ -f "$PLIST" ]; then
  stamp="$(date +%Y%m%d%H%M%S)"
  mv "$PLIST" "${PLIST}.off.${stamp}"
  echo "==> 已停用并归档 plist → ${PLIST}.off.${stamp}"
else
  echo "==> 守护未安装或已停用"
fi
