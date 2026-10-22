#!/usr/bin/env bash
# 停用灵动岛 LaunchAgent（plist 归档为 .off，不用 rm）。
set -euo pipefail

LABEL="com.atolla.island"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
STABLE_BIN="${HOME}/.atolla/bin/AtollaIsland"
UID_NUM="$(id -u)"

if launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
elif [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
fi

# 结束常驻进程（不删二进制，方便再次开启）
pkill -f "${STABLE_BIN}" 2>/dev/null || true

if [[ -f "$PLIST" ]]; then
  stamp="$(date +%Y%m%d%H%M%S)"
  mv "$PLIST" "${PLIST}.off.${stamp}"
  echo "==> 已停用并归档 plist → ${PLIST}.off.${stamp}"
else
  echo "==> LaunchAgent 未安装或已停用"
fi

printf '%s\n' '{"installed":true,"enabled":false,"detail":"已关闭灵动岛常驻"}'
