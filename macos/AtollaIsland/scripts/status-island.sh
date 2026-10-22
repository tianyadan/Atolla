#!/usr/bin/env bash
# 输出灵动岛安装/启用状态 JSON（供设置页 API）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.atolla.island"
STABLE_BIN="${HOME}/.atolla/bin/AtollaIsland"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

has_source=false
if [[ -f "$ROOT/Package.swift" && -d "$ROOT/Sources/AtollaIsland" ]]; then
  has_source=true
fi

has_xcode=false
xcode_detail=""
if [[ -d "/Applications/Xcode.app/Contents/Developer" ]]; then
  has_xcode=true
  xcode_detail="/Applications/Xcode.app"
elif [[ -d "/Users/tianhaowen/Desktop/Xcode.app/Contents/Developer" ]]; then
  has_xcode=true
  xcode_detail="/Users/tianhaowen/Desktop/Xcode.app"
elif command -v xcodebuild >/dev/null 2>&1; then
  if xcodebuild -version >/dev/null 2>&1; then
    has_xcode=true
    xcode_detail="xcodebuild"
  fi
fi

installed=false
if [[ -x "$STABLE_BIN" ]]; then
  installed=true
fi

enabled=false
if launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1 \
  || launchctl list "$LABEL" >/dev/null 2>&1; then
  enabled=true
fi

detail="未安装"
if $installed && $enabled; then
  detail="已安装并启用 LaunchAgent"
elif $installed; then
  detail="已编译安装，但未启用常驻"
elif $has_source && $has_xcode; then
  detail="检测到源码与 Xcode，可点安装"
elif $has_source && ! $has_xcode; then
  detail="有源码但未检测到完整 Xcode，请先安装 Xcode"
elif ! $has_source; then
  detail="未找到 macos/AtollaIsland 源码，请拉取可选目录后再安装"
fi

printf '{"installed":%s,"enabled":%s,"has_source":%s,"has_xcode":%s,"source_path":"%s","binary_path":"%s","xcode_detail":"%s","detail":"%s"}\n' \
  "$installed" "$enabled" "$has_source" "$has_xcode" \
  "$(json_escape "$ROOT")" \
  "$(json_escape "$STABLE_BIN")" \
  "$(json_escape "$xcode_detail")" \
  "$(json_escape "$detail")"
