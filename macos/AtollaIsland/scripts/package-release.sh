#!/usr/bin/env bash
# 在本机用 Xcode 编好未签名预编译包，上传 GitHub Release 供他人「下载即装」。
# 产物：dist/AtollaIsland-macos-<arch>-<stamp>.zip（不含 Apple 开发者证书）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -d "/Users/tianhaowen/Desktop/Xcode.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Users/tianhaowen/Desktop/Xcode.app/Contents/Developer"
elif [[ -d "/Applications/Xcode.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
fi

ARCH="$(uname -m)"
STAMP="$(date +%Y%m%d)"
if command -v git >/dev/null 2>&1 && git rev-parse --short HEAD >/dev/null 2>&1; then
  REV="$(git rev-parse --short HEAD)"
else
  REV="local"
fi
NAME="AtollaIsland-macos-${ARCH}-${STAMP}-${REV}"
DIST="$ROOT/dist"
STAGE="$DIST/stage"
OUT_DIR="$DIST/$NAME"
ZIP="$DIST/${NAME}.zip"

echo "==> build release ($ARCH)"
swift build -c release
BIN="$(swift build -c release --show-bin-path)/AtollaIsland"
if [[ ! -x "$BIN" ]]; then
  echo "错误: 编译失败，未找到 $BIN" >&2
  exit 1
fi

SPRITE_SRC="$ROOT/Sources/AtollaIsland/Resources/jelly-sprites"
if [[ ! -d "$SPRITE_SRC" ]]; then
  echo "错误: 缺少精灵图 $SPRITE_SRC" >&2
  exit 1
fi

echo "==> stage → $OUT_DIR"
# 重新铺目录（不用 rm：先移走旧 stage/out）
mkdir -p "$DIST"
if [[ -d "$STAGE" ]]; then
  mv "$STAGE" "$DIST/stage.bak.$(date +%s)"
fi
if [[ -d "$OUT_DIR" ]]; then
  mv "$OUT_DIR" "$DIST/${NAME}.bak.$(date +%s)"
fi
mkdir -p "$OUT_DIR"

cp "$BIN" "$OUT_DIR/AtollaIsland"
chmod +x "$OUT_DIR/AtollaIsland"
mkdir -p "$OUT_DIR/jelly-sprites"
cp -R "$SPRITE_SRC"/. "$OUT_DIR/jelly-sprites"/

# 包内一键脚本（用户解压后直接跑，不依赖仓库路径）
cp "$ROOT/scripts/install-prebuilt.sh" "$OUT_DIR/install.sh"
cp "$ROOT/scripts/configure.sh" "$OUT_DIR/configure.sh"
cp "$ROOT/scripts/uninstall-launchagent.sh" "$OUT_DIR/uninstall.sh"
chmod +x "$OUT_DIR/install.sh" "$OUT_DIR/configure.sh" "$OUT_DIR/uninstall.sh"

# 用户文档
cp "$ROOT/INSTALL.md" "$OUT_DIR/INSTALL.md"

cat >"$OUT_DIR/VERSION.txt" <<EOF
name=$NAME
arch=$ARCH
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
git=$REV
signed=no
note=未签名预编译包；安装脚本会清除 quarantine。需 macOS 14+。
EOF

# 同步一份 stage 便于本地试装：ATOLLA 从 scripts 调 install-prebuilt
mkdir -p "$STAGE"
cp -R "$OUT_DIR"/. "$STAGE"/

echo "==> zip → $ZIP"
(
  cd "$DIST"
  # zip 已存在则改名归档，避免覆盖丢历史
  if [[ -f "$ZIP" ]]; then
    mv "$ZIP" "${ZIP}.bak.$(date +%s)"
  fi
  ditto -c -k --keepParent "$NAME" "${NAME}.zip"
)

echo ""
echo "==> 完成"
echo "    包: $ZIP"
echo "    体积: $(du -h "$ZIP" | awk '{print $1}')"
echo ""
echo "发布到 GitHub："
echo "  1. 打开 https://github.com/tianyadan/Atolla/releases/new"
echo "  2. 上传 $ZIP"
echo "  3. Release 说明可直接贴 INSTALL.md 里的「别人怎么用」小节"
echo ""
echo "本地试装（无需再编译）："
echo "  cd $OUT_DIR && ./install.sh"
echo ""
