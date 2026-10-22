#!/usr/bin/env bash
# 安装并启用本机 LaunchAgent 后端守护。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.atolla.backend-watchdog"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST="${PLIST_DIR}/${LABEL}.plist"
CHECK="$ROOT/scripts/watchdog/local-check.sh"
UID_NUM="$(id -u)"

chmod +x "$CHECK" "$ROOT/scripts/watchdog/start-backend.sh" 2>/dev/null || true
mkdir -p "$PLIST_DIR" "${HOME}/.atolla/watchdog-local"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${CHECK}</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.atolla/watchdog-local/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.atolla/watchdog-local/launchd.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
EOF

# 先卸再装，兼容新旧 launchctl
if launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
elif launchctl list "$LABEL" >/dev/null 2>&1; then
  launchctl unload "$PLIST" 2>/dev/null || true
fi

if launchctl bootstrap "gui/${UID_NUM}" "$PLIST" 2>/dev/null; then
  launchctl enable "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
  launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
else
  launchctl load "$PLIST"
fi

echo "==> 已启用本机后端守护: $LABEL (grace=180s, interval=60s)"
