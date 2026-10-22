#!/usr/bin/env bash
# 仅拉起 Atolla Go 后端（不碰前端 / MySQL），供本机守护使用。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# 加载仓库根 .env
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PORT="${AVATAR_BACKEND_PORT:-8080}"
# AVATAR_ADDR 形如 :8080
ADDR="${AVATAR_ADDR:-:$PORT}"
case "$ADDR" in
  :*) PORT="${ADDR#:}" ;;
esac

HEALTH="http://127.0.0.1:${PORT}/health"
if curl -sf --max-time 3 "$HEALTH" >/dev/null 2>&1; then
  echo "==> 后端已健康 (:$PORT)，跳过启动"
  exit 0
fi

# 端口被占但无健康响应时，只清该端口监听进程，避免叠起多份
pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "${pids:-}" ]; then
  echo "==> 端口 :$PORT 有监听但无健康响应，结束 pid: $pids"
  kill $pids 2>/dev/null || true
  sleep 1
  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${pids:-}" ]; then
    kill -9 $pids 2>/dev/null || true
  fi
fi

echo "==> 启动 Go 后端 (端口 $PORT)"
cd "$ROOT/server"
export AVATAR_ADDR="${AVATAR_ADDR:-:$PORT}"
export AVATAR_DB_DSN="${AVATAR_DB_DSN:-root:root@tcp(127.0.0.1:3307)/colleague_avatar?parseTime=true&charset=utf8mb4&loc=Local}"
export AVATAR_CLAUDE_BIN="${AVATAR_CLAUDE_BIN:-claude}"
export AVATAR_ALLOWED_IPS="${AVATAR_ALLOWED_IPS:-127.0.0.1}"
export AVATAR_WORKSPACE_ROOT="${AVATAR_WORKSPACE_ROOT:-/Users/tianhaowen/Desktop/code_work_space}"
export AVATAR_TIMEOUT_SEC="${AVATAR_TIMEOUT_SEC:-28800}"
export AVATAR_PERMISSION_ENABLED="${AVATAR_PERMISSION_ENABLED:-1}"
export AVATAR_PERMISSION_WAIT_SEC="${AVATAR_PERMISSION_WAIT_SEC:-120}"
export AVATAR_REVIEW_TIMEOUT_SEC="${AVATAR_REVIEW_TIMEOUT_SEC:-20}"
export AVATAR_HOOK_BIN="${AVATAR_HOOK_BIN:-$(pwd)/bin/avatar-hook}"
export AVATAR_NOTIFY_SCRIPT="${AVATAR_NOTIFY_SCRIPT:-$ROOT/scripts/notify-bark-card.sh}"
export AVATAR_BARK_NOTIFY="${AVATAR_BARK_NOTIFY:-1}"
export AVATAR_BACKEND_URL="${AVATAR_BACKEND_URL:-http://127.0.0.1:${PORT}}"

mkdir -p bin
if [ ! -x bin/avatar-hook ]; then
  go build -o bin/avatar-hook ./cmd/avatar-hook 2>/dev/null || export AVATAR_PERMISSION_ENABLED=0
fi

LOG_DIR="${HOME}/.atolla/watchdog-local"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backend.log"

# 后台常驻：与 start.sh 的前台 go run 不同，需脱离当前 shell
nohup go run . >>"$LOG_FILE" 2>&1 &
echo "==> 后端已后台启动，日志: $LOG_FILE"

# 短暂等待健康
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf --max-time 2 "$HEALTH" >/dev/null 2>&1; then
    echo "==> 健康检查通过"
    exit 0
  fi
  sleep 1
done
echo "==> 警告: 启动后尚未就绪，守护将在下一轮宽限期后重试" >&2
exit 0
