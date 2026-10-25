#!/usr/bin/env bash
# 把 Atolla Island 装成 LaunchAgent（KeepAlive），避免终端关掉后岛消失。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -d "/Users/tianhaowen/Desktop/Xcode.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Users/tianhaowen/Desktop/Xcode.app/Contents/Developer"
elif [[ -d "/Applications/Xcode.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
fi

STABLE_DIR="${HOME}/.atolla/bin"
STABLE_BIN="${STABLE_DIR}/AtollaIsland"
mkdir -p "$STABLE_DIR" "${HOME}/.atolla"

# 预编译优先：ATOLLA_ISLAND_PREBUILT_BIN=/path/to/AtollaIsland
# 或已装过且 ATOLLA_ISLAND_SKIP_BUILD=1 时跳过编译
if [[ -n "${ATOLLA_ISLAND_PREBUILT_BIN:-}" && -f "${ATOLLA_ISLAND_PREBUILT_BIN}" ]]; then
  echo "==> use prebuilt $ATOLLA_ISLAND_PREBUILT_BIN"
  xattr -cr "$ATOLLA_ISLAND_PREBUILT_BIN" 2>/dev/null || true
  cp "$ATOLLA_ISLAND_PREBUILT_BIN" "$STABLE_BIN"
  chmod +x "$STABLE_BIN"
elif [[ "${ATOLLA_ISLAND_SKIP_BUILD:-0}" == "1" && -x "$STABLE_BIN" ]]; then
  echo "==> skip build, reuse $STABLE_BIN"
else
  echo "==> build release"
  swift build -c release
  BUILD_BIN_DIR="$(swift build -c release --show-bin-path)"
  BIN="${BUILD_BIN_DIR}/AtollaIsland"
  # 拷到稳定路径，避免 .build 路径变动
  cp "$BIN" "$STABLE_BIN"
  chmod +x "$STABLE_BIN"

  # SwiftPM 资源位于可执行文件旁的 bundle 中；仅复制二进制会导致运行时找不到品牌图标等资源。
  RESOURCE_BUNDLE_SRC="${BUILD_BIN_DIR}/AtollaIsland_AtollaIsland.bundle"
  RESOURCE_BUNDLE_DST="${STABLE_DIR}/AtollaIsland_AtollaIsland.bundle"
  if [[ -d "$RESOURCE_BUNDLE_SRC" ]]; then
    mkdir -p "$RESOURCE_BUNDLE_DST"
    cp -R "$RESOURCE_BUNDLE_SRC"/. "$RESOURCE_BUNDLE_DST"/
  fi
fi
xattr -cr "$STABLE_BIN" 2>/dev/null || true

# 像素水母精灵图（与 PC web/public/jelly-sprites 同源）
SPRITE_SRC="$ROOT/Sources/AtollaIsland/Resources/jelly-sprites"
SPRITE_DST="${STABLE_DIR}/jelly-sprites"
mkdir -p "$SPRITE_DST"
if [[ -d "$SPRITE_SRC" ]]; then
  cp -R "$SPRITE_SRC"/. "$SPRITE_DST"/
fi

LABEL="com.atolla.island"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST="${PLIST_DIR}/${LABEL}.plist"
UID_NUM="$(id -u)"
mkdir -p "$PLIST_DIR"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${STABLE_BIN}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.atolla/island.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.atolla/island.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
EOF

# 先卸再装
if launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
elif launchctl list "$LABEL" >/dev/null 2>&1; then
  launchctl unload "$PLIST" 2>/dev/null || true
fi

# 结束可能残留的手动启动进程
pkill -f "${STABLE_BIN}" 2>/dev/null || true
pkill -f '/AtollaIsland/.build/.*/AtollaIsland' 2>/dev/null || true
sleep 0.3

if launchctl bootstrap "gui/${UID_NUM}" "$PLIST" 2>/dev/null; then
  launchctl enable "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
  launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
else
  launchctl load "$PLIST"
fi

sleep 1
if pgrep -f "${STABLE_BIN}" >/dev/null 2>&1; then
  echo "==> Atolla Island 已常驻 (KeepAlive): $LABEL"
  echo "    二进制: $STABLE_BIN"
  echo "    日志: ~/.atolla/island.out.log / island.err.log"
else
  echo "==> 警告: 进程未看到，请查看 ~/.atolla/island.err.log" >&2
  tail -20 "${HOME}/.atolla/island.err.log" 2>/dev/null || true
  exit 1
fi
