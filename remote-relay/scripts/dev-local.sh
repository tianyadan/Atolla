#!/usr/bin/env bash
# 本机一键启动 remote-relay（与线上同一套服务，方便调试）
# 用法:
#   ./scripts/dev-local.sh           # API :3080 + Vite 手机端 :5173
#   ./scripts/dev-local.sh --api     # 仅 API
#   ./scripts/dev-local.sh --fresh   # 清空本地 SQLite 后启动（重新引导门禁密码）
#   SITE_PASSWORD=xxx ./scripts/dev-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_ONLY=0
FRESH=0
for arg in "$@"; do
  case "$arg" in
    --api) API_ONLY=1 ;;
    --fresh) FRESH=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg (use --api | --fresh | --help)" >&2
      exit 1
      ;;
  esac
done

# 可选本地覆盖：remote-relay/.env（勿提交密钥）
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

export PORT="${PORT:-3080}"
export SITE_PASSWORD="${SITE_PASSWORD:-localdev}"
export RELAY_JWT_SECRET="${RELAY_JWT_SECRET:-local-dev-jwt-secret-change-me}"
export NODE_ENV="${NODE_ENV:-development}"

WEB_PORT="${WEB_PORT:-15174}"
PIDS=()

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

port_busy() {
  local p="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

if port_busy "$PORT"; then
  echo "ERROR: 端口 $PORT 已被占用。换 PORT=xxxx 或先停掉占用进程。" >&2
  exit 1
fi

if [ "$API_ONLY" = 0 ] && port_busy "$WEB_PORT"; then
  echo "ERROR: 端口 $WEB_PORT 已被占用（Vite）。换 WEB_PORT=xxxx 或加 --api。" >&2
  exit 1
fi

echo "==> remote-relay 根目录: $ROOT"
if [ ! -d "$ROOT/node_modules" ] || [ ! -d "$ROOT/server/node_modules" ]; then
  echo "==> npm install（workspaces）"
  npm install
fi

if [ "$FRESH" = 1 ]; then
  echo "==> --fresh: 删除 server/data"
  rm -rf "$ROOT/server/data"
fi

mkdir -p "$ROOT/server/data"

echo "==> API  http://127.0.0.1:${PORT}"
echo "==> 门禁密码: ${SITE_PASSWORD}  （开发态会按 SITE_PASSWORD 同步进库；旧库不一致也会改）"
(
  cd "$ROOT/server"
  npm run dev
) &
PIDS+=($!)

# 等健康检查就绪
ok=0
for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 0.25
done
if [ "$ok" != 1 ]; then
  echo "ERROR: API 未在预期内就绪（/api/health）" >&2
  exit 1
fi
echo "==> health OK"

if [ "$API_ONLY" = 0 ]; then
  if [ ! -d "$ROOT/web/node_modules" ]; then
    echo "==> npm install -w web"
    npm install -w web
  fi
  echo "==> Web  http://127.0.0.1:${WEB_PORT}  (代理 /api → :${PORT})"
  (
    cd "$ROOT/web"
    npm run dev -- --port "$WEB_PORT" --host 127.0.0.1
  ) &
  PIDS+=($!)
fi

echo ""
echo "本机调试已启动。Ctrl+C 停止全部。"
echo "  curl http://127.0.0.1:${PORT}/api/health"
echo "  管理台 Bridge Base URL 可填: http://127.0.0.1:${PORT}"
echo ""

wait
