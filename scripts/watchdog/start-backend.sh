#!/usr/bin/env bash
# 仅拉起 Atolla Go 后端（不碰前端 / MySQL），供本机守护使用。
# 优先使用 ~/.atolla/watchdog-local/bin/atolla（安装时编译），避免 launchd 在 Desktop 仓库上 go build。
set -euo pipefail

STATE_DIR="${HOME}/.atolla/watchdog-local"
mkdir -p "$STATE_DIR"

if [ -n "${ATOLLA_REPO_ROOT:-}" ]; then
  ROOT="$ATOLLA_REPO_ROOT"
elif [ -f "$STATE_DIR/repo-root" ]; then
  ROOT="$(tr -d '\n' <"$STATE_DIR/repo-root")"
else
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi
cd "$ROOT"

# launchd PATH 极窄，不含 nvm；启动前把常见引擎 CLI 目录并入 PATH
enrich_engine_path() {
  local dirs=()
  local nvm="${NVM_DIR:-$HOME/.nvm}"
  dirs+=("$HOME/.local/bin" "$HOME/.bun/bin" "$HOME/.cargo/bin")
  if [ -f "$nvm/alias/default" ]; then
    local ver
    ver="$(tr -d '[:space:]' <"$nvm/alias/default")"
    ver="${ver#v}"
    [ -n "$ver" ] && dirs+=("$nvm/versions/node/v${ver}/bin")
  fi
  local d
  for d in $(ls -1d "$nvm/versions/node"/v*/bin 2>/dev/null | sort -V -r); do
    dirs+=("$d")
  done
  dirs+=("/opt/homebrew/bin" "/usr/local/bin" "/usr/bin" "/bin" "/usr/sbin" "/sbin")
  for d in "${dirs[@]}"; do
    [ -d "$d" ] || continue
    case ":$PATH:" in
      *":$d:"*) ;;
      *) PATH="$d:$PATH" ;;
    esac
  done
  export PATH
}

# 裸命令名（claude/codex/agent）尽量解析成绝对路径，避免子进程继承窄 PATH
resolve_engine_bin() {
  local bin="${1:-}"
  if [ -z "$bin" ]; then
    printf '%s' ""
    return
  fi
  if [[ "$bin" == /* ]]; then
    printf '%s' "$bin"
    return
  fi
  command -v "$bin" 2>/dev/null || printf '%s' "$bin"
}

enrich_engine_path

# 加载仓库根 .env（若 launchd 因 TCC 读不到 Desktop，安装阶段已把关键项写入 env.sh）
if [ -f "$STATE_DIR/env.sh" ]; then
  # shellcheck disable=SC1091
  set -a
  . "$STATE_DIR/env.sh"
  set +a
elif [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# env.sh 可能覆盖 PATH；再补一次，并固化 Claude 二进制路径
enrich_engine_path
export PATH

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
export AVATAR_ADDR="${AVATAR_ADDR:-:$PORT}"
export AVATAR_DB_DRIVER="${AVATAR_DB_DRIVER:-sqlite}"
if [ "$AVATAR_DB_DRIVER" = "mysql" ]; then
  export AVATAR_DB_DSN="${AVATAR_DB_DSN:-root:root@tcp(127.0.0.1:3307)/colleague_avatar?parseTime=true&charset=utf8mb4&loc=Local}"
else
  mkdir -p "$ROOT/data"
  export AVATAR_DB_DSN="${AVATAR_DB_DSN:-$ROOT/data/atolla.db}"
fi
export AVATAR_CLAUDE_BIN="$(resolve_engine_bin "${AVATAR_CLAUDE_BIN:-claude}")"
export AVATAR_ALLOWED_IPS="${AVATAR_ALLOWED_IPS:-127.0.0.1}"
export AVATAR_WORKSPACE_ROOT="${AVATAR_WORKSPACE_ROOT:-$ROOT}"
export AVATAR_TIMEOUT_SEC="${AVATAR_TIMEOUT_SEC:-28800}"
export AVATAR_PERMISSION_ENABLED="${AVATAR_PERMISSION_ENABLED:-1}"
export AVATAR_PERMISSION_WAIT_SEC="${AVATAR_PERMISSION_WAIT_SEC:-120}"
export AVATAR_REVIEW_TIMEOUT_SEC="${AVATAR_REVIEW_TIMEOUT_SEC:-20}"
export AVATAR_HOOK_BIN="${AVATAR_HOOK_BIN:-$ROOT/server/bin/avatar-hook}"
export AVATAR_NOTIFY_SCRIPT="${AVATAR_NOTIFY_SCRIPT:-$ROOT/scripts/notify-bark-card.sh}"
export AVATAR_BARK_NOTIFY="${AVATAR_BARK_NOTIFY:-1}"
export AVATAR_BACKEND_URL="${AVATAR_BACKEND_URL:-http://127.0.0.1:${PORT}}"

# 托管员工 bin_path 常为裸名 claude/codex/agent，依赖进程 PATH
echo "==> 引擎 PATH 探测: claude=$(command -v claude 2>/dev/null || echo missing) codex=$(command -v codex 2>/dev/null || echo missing) agent=$(command -v agent 2>/dev/null || echo missing)"
echo "==> AVATAR_CLAUDE_BIN=$AVATAR_CLAUDE_BIN"

HOME_BIN="$STATE_DIR/bin/atolla"
REPO_BIN="$ROOT/server/bin/atolla"
BIN=""
if [ -x "$HOME_BIN" ]; then
  BIN="$HOME_BIN"
elif [ -x "$REPO_BIN" ]; then
  BIN="$REPO_BIN"
fi

# 安装态应已有 HOME_BIN；若缺失则尝试在仓库内构建（需当前进程能读仓库）
if [ -z "$BIN" ]; then
  echo "==> 未找到预编译二进制，尝试 go build"
  mkdir -p "$STATE_DIR/bin" "$ROOT/server/bin"
  if [ ! -x "$ROOT/server/bin/avatar-hook" ]; then
    (cd "$ROOT/server" && go build -o bin/avatar-hook ./cmd/avatar-hook) 2>/dev/null \
      || export AVATAR_PERMISSION_ENABLED=0
  fi
  (cd "$ROOT/server" && go build -o "$HOME_BIN" .) || (cd "$ROOT/server" && go build -o "$REPO_BIN" .)
  if [ -x "$HOME_BIN" ]; then
    BIN="$HOME_BIN"
  else
    BIN="$REPO_BIN"
  fi
  chmod +x "$BIN" 2>/dev/null || true
fi

LOG_FILE="$STATE_DIR/backend.log"

# nohup + 重定向脱离终端；LaunchAgent 需配合 AbandonProcessGroup，避免检查脚本退出时杀后端
nohup "$BIN" >>"$LOG_FILE" 2>&1 < /dev/null &
echo $! >"$STATE_DIR/backend.pid"
echo "==> 后端已后台启动 pid=$(cat "$STATE_DIR/backend.pid") bin=$BIN 日志: $LOG_FILE"

# 短暂等待健康
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -sf --max-time 2 "$HEALTH" >/dev/null 2>&1; then
    echo "==> 健康检查通过"
    exit 0
  fi
  sleep 1
done
echo "==> 警告: 启动后尚未就绪，守护将在下一轮宽限期后重试" >&2
exit 0
