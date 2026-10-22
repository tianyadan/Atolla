#!/usr/bin/env bash
# 推荐：安装并启动常驻岛（LaunchAgent KeepAlive）
# 临时前台调试：FOREGROUND=1 ./scripts/run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${FOREGROUND:-0}" == "1" ]]; then
  if [[ -d "/Users/tianhaowen/Desktop/Xcode.app/Contents/Developer" ]]; then
    export DEVELOPER_DIR="/Users/tianhaowen/Desktop/Xcode.app/Contents/Developer"
  elif [[ -d "/Applications/Xcode.app/Contents/Developer" ]]; then
    export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
  fi
  swift build -c release
  BIN="$(swift build -c release --show-bin-path)/AtollaIsland"
  echo "==> foreground $BIN"
  exec "$BIN"
fi

exec "$ROOT/scripts/install-launchagent.sh"
