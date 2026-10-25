#!/usr/bin/env bash
# 从预编译包安装灵动岛（无需 Xcode）。
# 用法：解压 Release zip 后在包目录执行 ./install.sh（或本脚本）。
set -euo pipefail

# 包根目录：优先脚本旁的预编译布局，否则回退到仓库 Sources 旁的 dist 布局
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -x "$SCRIPT_DIR/AtollaIsland" ]]; then
  PKG="$SCRIPT_DIR"
elif [[ -x "$SCRIPT_DIR/../dist/stage/AtollaIsland" ]]; then
  PKG="$(cd "$SCRIPT_DIR/../dist/stage" && pwd)"
else
  PKG="$SCRIPT_DIR"
fi

BIN_SRC="${ATOLLA_ISLAND_BIN:-$PKG/AtollaIsland}"
SPRITE_SRC="${ATOLLA_ISLAND_SPRITES:-$PKG/jelly-sprites}"

if [[ ! -x "$BIN_SRC" && ! -f "$BIN_SRC" ]]; then
  echo "错误: 找不到预编译二进制: $BIN_SRC" >&2
  echo "请先下载 GitHub Release 的 AtollaIsland-macos-*.zip 并解压后再运行。" >&2
  exit 1
fi

STABLE_DIR="${HOME}/.atolla/bin"
STABLE_BIN="${STABLE_DIR}/AtollaIsland"
SPRITE_DST="${STABLE_DIR}/jelly-sprites"
LABEL="com.atolla.island"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST="${PLIST_DIR}/${LABEL}.plist"
UID_NUM="$(id -u)"

mkdir -p "$STABLE_DIR" "${HOME}/.atolla" "$PLIST_DIR"

echo "==> 清除下载隔离属性（无开发者证书时必需）"
# 去掉 Gatekeeper quarantine，避免「无法打开，因为无法验证开发者」
xattr -cr "$PKG" 2>/dev/null || true
xattr -d com.apple.quarantine "$BIN_SRC" 2>/dev/null || true

echo "==> 安装二进制 → $STABLE_BIN"
cp "$BIN_SRC" "$STABLE_BIN"
chmod +x "$STABLE_BIN"
xattr -cr "$STABLE_BIN" 2>/dev/null || true

# SPM Bundle.module 依赖二进制旁的 AtollaIsland_AtollaIsland.bundle
BUNDLE_SRC="$PKG/AtollaIsland_AtollaIsland.bundle"
BUNDLE_DST="${STABLE_DIR}/AtollaIsland_AtollaIsland.bundle"
if [[ -d "$BUNDLE_SRC" ]]; then
  echo "==> 安装 SPM 资源包 → $BUNDLE_DST"
  mkdir -p "$BUNDLE_DST"
  cp -R "$BUNDLE_SRC"/. "$BUNDLE_DST"/
  xattr -cr "$BUNDLE_DST" 2>/dev/null || true
else
  echo "错误: 包内缺少 AtollaIsland_AtollaIsland.bundle（与 AtollaIsland 同目录）。" >&2
  echo "       旧版 zip 未打包该资源会导致启动 fatal；请换用新版 Release，或手动补齐 bundle。" >&2
  exit 1
fi

if [[ -d "$SPRITE_SRC" ]]; then
  echo "==> 安装精灵图 → $SPRITE_DST"
  mkdir -p "$SPRITE_DST"
  cp -R "$SPRITE_SRC"/. "$SPRITE_DST"/
  xattr -cr "$SPRITE_DST" 2>/dev/null || true
else
  echo "==> 警告: 未找到 jelly-sprites，岛内像素水母可能空白" >&2
fi

# 写 LaunchAgent（登录常驻）
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

if launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
elif launchctl list "$LABEL" >/dev/null 2>&1; then
  launchctl unload "$PLIST" 2>/dev/null || true
fi

pkill -f "${STABLE_BIN}" 2>/dev/null || true
sleep 0.3

if launchctl bootstrap "gui/${UID_NUM}" "$PLIST" 2>/dev/null; then
  launchctl enable "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
  launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
else
  launchctl load "$PLIST"
fi

sleep 1
if pgrep -f "${STABLE_BIN}" >/dev/null 2>&1; then
  echo "==> Atolla Island 已常驻: $LABEL"
  echo "    二进制: $STABLE_BIN"
  echo "    日志: ~/.atolla/island.out.log / island.err.log"
else
  echo "==> 警告: 进程未起来，请看 ~/.atolla/island.err.log" >&2
  echo "    若系统提示无法验证开发者：对 AtollaIsland 右键 → 打开，或再跑一次本脚本。" >&2
  tail -20 "${HOME}/.atolla/island.err.log" 2>/dev/null || true
  exit 1
fi

echo ""
echo "下一步（二选一）："
echo "  1) 推荐：打开 Atolla 管理台并登录一次 → 自动写入 ~/.atolla/island.json"
echo "  2) 手动：./configure.sh  （或 ATOLLA_TOKEN=xxx ./configure.sh）"
echo ""
