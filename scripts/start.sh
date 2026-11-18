#!/usr/bin/env bash
# 启动 Atolla: 默认 SQLite（免 Docker）；可选 MySQL
# 用法:
#   scripts/start.sh                 # 前台：终端关了进程也停
#   scripts/start.sh --daemon        # 后台：可关终端，日志在 logs/
#   scripts/start.sh --bg            # 同 --daemon
#   scripts/start.sh --mysql         # 启动 docker MySQL 并连接
#   scripts/start.sh --mysql --daemon
#   AVATAR_DB_DRIVER=mysql scripts/start.sh --mysql
# 停止: scripts/shutdown.sh
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# 加载仓库根 .env（密钥等，勿提交）
# 不用 source：DSN 等含 tcp(...)、&、? 时会被 shell 解析报错
load_dotenv() {
  local file="$1" line key val
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    val="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    case "$key" in
      ''|*[!A-Za-z0-9_]*) continue ;;
    esac
    if [ "${#val}" -ge 2 ]; then
      case "$val" in
        \'*\') val="${val:1:${#val}-2}" ;;
        \"*\") val="${val:1:${#val}-2}" ;;
      esac
    fi
    export "$key=$val"
  done < "$file"
}
load_dotenv .env

DAEMON=0
WANT_MYSQL=0
for arg in "$@"; do
  case "$arg" in
    --daemon|--bg|-d) DAEMON=1 ;;
    --mysql) WANT_MYSQL=1 ;;
    --help|-h)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $arg（支持 --daemon / --bg / --mysql）" >&2
      exit 1
      ;;
  esac
done

DRIVER="${AVATAR_DB_DRIVER:-sqlite}"

if [ "$WANT_MYSQL" = 1 ] || [ "$DRIVER" = "mysql" ]; then
  DRIVER=mysql
  echo "==> 启动 MySQL (docker compose)"
  docker compose up -d mysql
  echo "==> 等待 MySQL 就绪"
  for i in {1..30}; do
    if docker exec atolla-mysql mysqladmin ping -uroot -proot --silent >/dev/null 2>&1 \
      || docker exec colleague-avatar-mysql mysqladmin ping -uroot -proot --silent >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  export AVATAR_DB_DSN="${AVATAR_DB_DSN:-root:root@tcp(127.0.0.1:3307)/colleague_avatar?parseTime=true&charset=utf8mb4&loc=Local}"
else
  DRIVER=sqlite
  mkdir -p data
  export AVATAR_DB_DSN="${AVATAR_DB_DSN:-$(pwd)/data/atolla.db}"
  echo "==> 使用 SQLite: ${AVATAR_DB_DSN}"
fi

echo "==> 启动 Go 后端 (端口 8080, driver=${DRIVER})"
cd server
export AVATAR_DB_DRIVER="${DRIVER}"
export AVATAR_ADDR="${AVATAR_ADDR:-:8080}"
export AVATAR_CLAUDE_BIN="${AVATAR_CLAUDE_BIN:-claude}"
export AVATAR_ALLOWED_IPS="${AVATAR_ALLOWED_IPS:-127.0.0.1,::1}"
export AVATAR_WORKSPACE_ROOT="${AVATAR_WORKSPACE_ROOT:-/Users/tianhaowen/Desktop/code_work_space}"
export AVATAR_TIMEOUT_SEC="${AVATAR_TIMEOUT_SEC:-28800}"
export AVATAR_DATA_DB_DSN="${AVATAR_DATA_DB_DSN:-}"
export AVATAR_PERMISSION_ENABLED="${AVATAR_PERMISSION_ENABLED:-1}"
export AVATAR_PERMISSION_WAIT_SEC="${AVATAR_PERMISSION_WAIT_SEC:-120}"
export AVATAR_REVIEW_TIMEOUT_SEC="${AVATAR_REVIEW_TIMEOUT_SEC:-20}"
export AVATAR_HOOK_BIN="${AVATAR_HOOK_BIN:-$(pwd)/bin/avatar-hook}"
export AVATAR_NOTIFY_SCRIPT="${AVATAR_NOTIFY_SCRIPT:-$(cd .. && pwd)/scripts/notify-bark-card.sh}"
export AVATAR_BARK_NOTIFY="${AVATAR_BARK_NOTIFY:-1}"
chmod +x "$AVATAR_NOTIFY_SCRIPT" 2>/dev/null || true

echo "==> 构建 PreToolUse hook (bin/avatar-hook)"
mkdir -p bin
go build -o bin/avatar-hook ./cmd/avatar-hook || { echo "hook 构建失败,授权代理将不可用"; export AVATAR_PERMISSION_ENABLED=0; }

# 从常见 shell 配置注入 BARK_KEY(若当前环境未设置)
if [[ -z "${BARK_KEY:-}" ]]; then
  for f in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bashrc" "$HOME/.profile"; do
    if [[ -f "$f" ]]; then
      k=$(grep -E '^\s*(export\s+)?BARK_KEY=' "$f" 2>/dev/null | tail -1 | sed -E 's/.*BARK_KEY=//; s/^["'\'']//; s/["'\''].*$//; s/[[:space:]]*$//')
      if [[ -n "${k:-}" ]]; then
        export BARK_KEY="$k"
        break
      fi
    fi
  done
fi

LOG_DIR="${AVATAR_LOG_DIR:-$ROOT/logs}"
mkdir -p "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
PID_DIR="$LOG_DIR"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"

if [ "$DAEMON" = 1 ]; then
  # 后台：nohup 脱离终端，关窗口不杀进程
  echo "==> 后台模式（可关闭终端）"
  nohup go run . >>"$BACKEND_LOG" 2>&1 &
  echo $! >"$BACKEND_PID_FILE"
  echo "==> 后端 pid $(cat "$BACKEND_PID_FILE") 日志: $BACKEND_LOG"

  sleep 2
  echo "==> 启动 React 前端 (vite, 局域网可访问, 后台)"
  cd ../web
  # 缺依赖时先安装，避免 vite: command not found
  if [ ! -d node_modules ] || [ ! -x node_modules/.bin/vite ]; then
    echo "==> web/node_modules 缺失，执行 npm install"
    npm install
  fi
  : >"$FRONTEND_LOG"
  nohup npm run dev -- --host 0.0.0.0 >>"$FRONTEND_LOG" 2>&1 &
  echo $! >"$FRONTEND_PID_FILE"
  echo "==> 前端 pid $(cat "$FRONTEND_PID_FILE") 日志: $FRONTEND_LOG"
  echo ""
  echo "==> 已后台启动，可关闭本终端。"
  echo "    页面 http://localhost:5173"
  echo "    API  http://localhost:8080"
  echo "    看日志: tail -f $BACKEND_LOG"
  echo "           tail -f $FRONTEND_LOG"
  echo "    停止:   ./scripts/shutdown.sh"
  exit 0
fi

# 前台：后端后台跑，前端占住终端；关终端会走 trap 停后端
go run . &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT

sleep 2
echo "==> 启动 React 前端 (vite, 局域网可访问)"
echo "    提示: 若要关终端仍保持运行，请用 ./scripts/start-bg.sh 或 ./scripts/start.sh --daemon"
cd ../web
# 缺依赖时先安装，避免 vite: command not found
if [ ! -d node_modules ] || [ ! -x node_modules/.bin/vite ]; then
  echo "==> web/node_modules 缺失，执行 npm install"
  npm install
fi
npm run dev -- --host 0.0.0.0
