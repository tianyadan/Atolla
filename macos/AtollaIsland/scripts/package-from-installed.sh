#!/usr/bin/env bash
# 无 Xcode：用本机已安装的 ~/.atolla/bin 产物打 Release zip（补齐 .bundle）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STABLE="${HOME}/.atolla/bin"
DIST="$ROOT/dist"
ARCH="$(uname -m)"
STAMP="$(date +%Y%m%d)"
REV="${1:-repack-bundle}"
NAME="AtollaIsland-macos-${ARCH}-${STAMP}-${REV}"
OUT="$DIST/$NAME"
ZIP="$DIST/${NAME}.zip"

test -x "$STABLE/AtollaIsland" || { echo "缺少 $STABLE/AtollaIsland" >&2; exit 1; }
test -d "$STABLE/AtollaIsland_AtollaIsland.bundle" || { echo "缺少 .bundle，请先修好本机安装" >&2; exit 1; }

mkdir -p "$DIST"
[[ -d "$OUT" ]] && mv "$OUT" "$DIST/${NAME}.bak.$(date +%s)"
[[ -f "$ZIP" ]] && mv "$ZIP" "${ZIP}.bak.$(date +%s)"
mkdir -p "$OUT"

cp "$STABLE/AtollaIsland" "$OUT/AtollaIsland"
chmod +x "$OUT/AtollaIsland"
cp -R "$STABLE/AtollaIsland_AtollaIsland.bundle" "$OUT/"
mkdir -p "$OUT/jelly-sprites"
cp -R "$STABLE/jelly-sprites"/. "$OUT/jelly-sprites"/
cp "$ROOT/scripts/install-prebuilt.sh" "$OUT/install.sh"
cp "$ROOT/scripts/configure.sh" "$OUT/configure.sh"
cp "$ROOT/scripts/uninstall-launchagent.sh" "$OUT/uninstall.sh"
cp "$ROOT/INSTALL.md" "$OUT/INSTALL.md"
chmod +x "$OUT"/install.sh "$OUT"/configure.sh "$OUT"/uninstall.sh
cat >"$OUT/VERSION.txt" <<VER
name=$NAME
arch=$ARCH
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
git=$REV
signed=no
note=无 Xcode 重打包（installed binary + SPM bundle）
VER
xattr -cr "$OUT" 2>/dev/null || true
( cd "$DIST" && ditto -c -k --keepParent "$NAME" "${NAME}.zip" )
echo "完成: $ZIP"
shasum -a 256 "$ZIP"
