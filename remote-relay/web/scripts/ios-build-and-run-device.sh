#!/usr/bin/env bash
# 方案 A：Web 同步 + 真机 Debug 构建/安装/启动（禁止模拟器）。
# 用法（在 remote-relay/web）:
#   bash scripts/ios-build-and-run-device.sh
# 或由 Atolla 本机服务调用。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET_JSON="$ROOT/ios/build-target.json"
IOS_APP_DIR="$ROOT/ios/App"
DERIVED="$ROOT/ios/build-device"
WORKSPACE="$IOS_APP_DIR/App.xcworkspace"
SCHEME="App"
CONFIGURATION="Debug"
BUILD_MODE="${ATOLLA_IOS_BUILD_MODE:-incremental}"
XCODE_APP="${ATOLLA_XCODE_APP_PATH:-}"

log() { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

# --- preflight ---
log "==> [preflight] macOS / Xcode"
[[ "$(uname -s)" == "Darwin" ]] || fail "需要 macOS"
[[ "$BUILD_MODE" == "incremental" || "$BUILD_MODE" == "full" ]] || fail "未知构建方式: $BUILD_MODE"

# 指定 Xcode 时只影响本次任务，不修改全局 xcode-select；尽量隐藏启动 GUI。
if [[ -n "$XCODE_APP" ]]; then
  [[ -d "$XCODE_APP" ]] || fail "Xcode 应用不存在: $XCODE_APP"
  export DEVELOPER_DIR="${DEVELOPER_DIR:-$XCODE_APP/Contents/Developer}"
  export PATH="$DEVELOPER_DIR/usr/bin:$PATH"
  open -gj "$XCODE_APP" >/dev/null 2>&1 || true
  log "==> [preflight] 使用指定 Xcode: $XCODE_APP"
fi
command -v xcodebuild >/dev/null 2>&1 || fail "找不到 xcodebuild，请安装完整 Xcode"
command -v xcrun >/dev/null 2>&1 || fail "找不到 xcrun"
xcodebuild -version >/dev/null 2>&1 || fail "xcodebuild 不可用（打开一次 Xcode 接受协议）"
[[ -d "$WORKSPACE" ]] || fail "缺少 Workspace: $WORKSPACE"
[[ -f "$TARGET_JSON" ]] || fail "缺少真机锁定配置: $TARGET_JSON"

# 从 build-target.json 读取 UDID / CoreDeviceId（python3 保底解析）
read_json() {
  local key="$1"
  python3 - "$TARGET_JSON" "$key" <<'PY'
import json,sys
with open(sys.argv[1],encoding="utf-8") as f:
    d=json.load(f)
key=sys.argv[2]
cur=d
for part in key.split("."):
    if not isinstance(cur,dict) or part not in cur:
        sys.exit(1)
    cur=cur[part]
print(cur)
PY
}

MODE="$(read_json mode || true)"
EXCLUDE="$(read_json excludeSimulators || true)"
UDID="$(read_json device.udid)"
CORE_ID="$(read_json device.coreDeviceId)"
DEVICE_NAME="$(read_json device.name || true)"
DEST="$(read_json xcodebuildDestination)"
SDK="$(read_json sdk || true)"

[[ "${MODE:-device}" == "device" ]] || fail "build-target.mode 必须为 device"
[[ "${EXCLUDE:-true}" == "True" || "${EXCLUDE:-true}" == "true" ]] || fail "必须 excludeSimulators=true"
[[ -n "$UDID" ]] || fail "缺少 device.udid"
[[ -n "$CORE_ID" ]] || fail "缺少 device.coreDeviceId"
[[ -n "$DEST" ]] || DEST="platform=iOS,id=$UDID"
[[ "${SDK:-iphoneos}" == "iphoneos" ]] || fail "sdk 必须为 iphoneos（禁止模拟器）"
case "$DEST" in
  *Simulator*|*iphonesimulator*) fail "destination 含模拟器，已拒绝: $DEST" ;;
esac

log "==> [preflight] 检查真机连接: ${DEVICE_NAME:-?} ($UDID)"
if ! xcrun xctrace list devices 2>/dev/null | grep -F "$UDID" >/dev/null; then
  # CoreDevice 列表作为兜底
  if ! xcrun devicectl list devices 2>/dev/null | grep -F "$CORE_ID" >/dev/null; then
    fail "真机未连接或不可见: $UDID / $CORE_ID"
  fi
fi

# Scheme 存在性
if ! xcodebuild -workspace "$WORKSPACE" -list 2>/dev/null | grep -E '^\s+App$' >/dev/null; then
  fail "Workspace 缺少共享 Scheme「App」，请确认 ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme"
fi

# --- web sync ---
if [[ "$BUILD_MODE" == "full" ]]; then
  log "==> [web_sync] npm run cap:sync (full)"
  npm run cap:sync
else
  log "==> [web_sync] npm run cap:copy (incremental)"
  npm run cap:copy
fi

PUBLIC_INDEX="$ROOT/ios/App/App/public/index.html"
[[ -f "$PUBLIC_INDEX" ]] || fail "资源同步失败：缺少 $PUBLIC_INDEX"

# --- native build ---
log "==> [native_build] xcodebuild $BUILD_MODE → $DEST"
mkdir -p "$DERIVED"
BUILD_ACTIONS=(build)
if [[ "$BUILD_MODE" == "full" ]]; then
  BUILD_ACTIONS=(clean build)
fi
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination "$DEST" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  "${BUILD_ACTIONS[@]}"

APP_PATH="$DERIVED/Build/Products/Debug-iphoneos/App.app"
[[ -d "$APP_PATH" ]] || fail "构建产物不存在（期望 Debug-iphoneos）: $APP_PATH"
case "$APP_PATH" in
  *iphonesimulator*) fail "产物落在模拟器目录，已拒绝" ;;
esac

# --- install + launch ---
log "==> [install_run] 安装到真机 $CORE_ID"
xcrun devicectl device install app --device "$CORE_ID" "$APP_PATH"
log "==> [install_run] 启动 com.atolla.mobile"
xcrun devicectl device process launch --device "$CORE_ID" com.atolla.mobile

log "==> done OK"
log "device: ${DEVICE_NAME:-iPhone} udid=$UDID"
log "app: $APP_PATH"
