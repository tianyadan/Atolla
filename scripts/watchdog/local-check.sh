#!/usr/bin/env bash
# 本机后端守护：探 /health，连续不健康满 GRACE_SEC 才拉起后端。
# 由 launchd 约每 60s 调用一次。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${AVATAR_BACKEND_PORT:-8080}"
if [ -n "${AVATAR_ADDR:-}" ]; then
  case "$AVATAR_ADDR" in
    :*) PORT="${AVATAR_ADDR#:}" ;;
  esac
fi
HEALTH="http://127.0.0.1:${PORT}/health"
GRACE_SEC="${ATOLLA_LOCAL_WATCHDOG_GRACE_SEC:-180}"
STATE_DIR="${HOME}/.atolla/watchdog-local"
STATE_FILE="$STATE_DIR/down-since"
mkdir -p "$STATE_DIR"

now="$(date +%s)"

if curl -sf --max-time 5 "$HEALTH" >/dev/null 2>&1; then
  # 健康则清空计时（写空文件，避免使用 rm）
  : >"$STATE_FILE"
  exit 0
fi

if [ ! -s "$STATE_FILE" ]; then
  printf '%s' "$now" >"$STATE_FILE"
  echo "==> 后端不健康，开始计时 (grace=${GRACE_SEC}s)"
  exit 0
fi

since="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
# 非数字则重置
if ! [[ "$since" =~ ^[0-9]+$ ]]; then
  printf '%s' "$now" >"$STATE_FILE"
  exit 0
fi

elapsed=$((now - since))
if [ "$elapsed" -lt "$GRACE_SEC" ]; then
  echo "==> 后端不健康已 ${elapsed}s / ${GRACE_SEC}s，等待宽限期"
  exit 0
fi

echo "==> 宽限期已满 (${elapsed}s)，尝试拉起后端"
"$ROOT/scripts/watchdog/start-backend.sh" || true
# 拉起后再等一轮宽限期，避免更新窗口内连续叠启
printf '%s' "$now" >"$STATE_FILE"
exit 0
