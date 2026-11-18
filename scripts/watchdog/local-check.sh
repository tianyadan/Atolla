#!/usr/bin/env bash
# 本机后端守护：探 /health，连续不健康满 GRACE_SEC 才拉起后端。
# 由 launchd 约每 60s 调用一次。
#
# 开源兼容：安装时会把本脚本复制到 ~/.atolla/watchdog-local/，
# LaunchAgent 只跑家目录副本（避免仓库在 Desktop/Documents 时 TCC 拒绝执行）。
set -euo pipefail

STATE_DIR="${HOME}/.atolla/watchdog-local"
mkdir -p "$STATE_DIR"

# 仓库根：优先环境变量 / 安装时写入的 repo-root；否则按脚本相对路径推断
if [ -n "${ATOLLA_REPO_ROOT:-}" ]; then
  ROOT="$ATOLLA_REPO_ROOT"
elif [ -f "$STATE_DIR/repo-root" ]; then
  ROOT="$(tr -d '\n' <"$STATE_DIR/repo-root")"
elif [ -f "$(cd "$(dirname "$0")" && pwd)/repo-root" ]; then
  ROOT="$(tr -d '\n' <"$(cd "$(dirname "$0")" && pwd)/repo-root")"
else
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi

PORT="${AVATAR_BACKEND_PORT:-8080}"
if [ -n "${AVATAR_ADDR:-}" ]; then
  case "$AVATAR_ADDR" in
    :*) PORT="${AVATAR_ADDR#:}" ;;
  esac
fi
HEALTH="http://127.0.0.1:${PORT}/health"
GRACE_SEC="${ATOLLA_LOCAL_WATCHDOG_GRACE_SEC:-180}"
STATE_FILE="$STATE_DIR/down-since"
LAST_CHECK="$STATE_DIR/last-check"
START_SH="$STATE_DIR/start-backend.sh"
if [ ! -x "$START_SH" ]; then
  START_SH="$ROOT/scripts/watchdog/start-backend.sh"
fi

now="$(date +%s)"

# 记录探活结果，供 status-local 判断「是否真的在跑」而不只是 plist 已加载
write_last_check() {
  local ok="$1"
  local msg="$2"
  printf 'ok=%s\nts=%s\nmsg=%s\n' "$ok" "$now" "$msg" >"$LAST_CHECK"
}

if curl -sf --max-time 5 "$HEALTH" >/dev/null 2>&1; then
  # 健康则清空计时（写空文件，避免使用 rm）
  : >"$STATE_FILE"
  write_last_check 1 "healthy"
  exit 0
fi

if [ ! -s "$STATE_FILE" ]; then
  printf '%s' "$now" >"$STATE_FILE"
  write_last_check 0 "unhealthy: grace started"
  echo "==> 后端不健康，开始计时 (grace=${GRACE_SEC}s)"
  exit 0
fi

since="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
# 非数字则重置
if ! [[ "$since" =~ ^[0-9]+$ ]]; then
  printf '%s' "$now" >"$STATE_FILE"
  write_last_check 0 "unhealthy: grace reset"
  exit 0
fi

elapsed=$((now - since))
if [ "$elapsed" -lt "$GRACE_SEC" ]; then
  write_last_check 0 "unhealthy: waiting ${elapsed}/${GRACE_SEC}s"
  echo "==> 后端不健康已 ${elapsed}s / ${GRACE_SEC}s，等待宽限期"
  exit 0
fi

echo "==> 宽限期已满 (${elapsed}s)，尝试拉起后端"
export ATOLLA_REPO_ROOT="$ROOT"
if [ -x "$START_SH" ]; then
  /bin/bash "$START_SH" || true
else
  echo "==> 缺少 start-backend.sh: $START_SH" >&2
  write_last_check 0 "start script missing"
  exit 0
fi
# 拉起后再等一轮宽限期，避免更新窗口内连续叠启
printf '%s' "$now" >"$STATE_FILE"
write_last_check 0 "restart attempted after ${elapsed}s"
exit 0
