#!/usr/bin/env bash
#
# Atolla Electron 开发模式（热更新）
#
# - 启动 / 复用 Vite → React HMR（改 web/ 几乎即时生效）
# - 启动 Electron，渲染进程加载 http://127.0.0.1:5173
# - 监听 desktop 主进程文件；变更后自动 relaunch Electron
# - dev-runner 独立持有 Go 后端（127.0.0.1:8080），Electron 热重启不影响后端
#
# 用法：
#   ./scripts/dev-electron.sh              # 推荐：一键开发
#   ./scripts/dev-electron.sh --watch-go   # 额外监听 server/*.go，变更后只重启 Go
#   ./scripts/dev-electron.sh --no-devtools
#   ./scripts/dev-electron.sh --help
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WEB_DIR="${ROOT_DIR}/web"
DESKTOP_DIR="${ROOT_DIR}/desktop"
VITE_URL="${ATOLLA_ELECTRON_RENDERER_URL:-http://127.0.0.1:5173}"
VITE_PID=""
WATCH_GO=0
OPEN_DEVTOOLS=1

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  awk 'NR > 2 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch-go)
      WATCH_GO=1
      shift
      ;;
    --no-devtools)
      OPEN_DEVTOOLS=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数：$1（使用 --help 查看用法）"
      ;;
  esac
done

[[ -f "${DESKTOP_DIR}/package.json" ]] || die "找不到 desktop/package.json"
[[ -f "${WEB_DIR}/package.json" ]] || die "找不到 web/package.json"
command -v node >/dev/null 2>&1 || die "未安装 Node.js"
command -v npm  >/dev/null 2>&1 || die "未安装 npm"
command -v go   >/dev/null 2>&1 || die "未安装 Go（开发运行器会 go run 后端）"
command -v curl >/dev/null 2>&1 || die "未安装 curl"

# 国内镜像（可被环境变量覆盖）
export npm_config_registry="${npm_config_registry:-https://registry.npmmirror.com}"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

ensure_deps() {
  local dir="$1" name="$2"
  if [[ ! -d "${dir}/node_modules" ]]; then
    info "安装 ${name} 依赖（npm ci）…"
    ( cd "${dir}" && npm ci )
  else
    info "复用已有 ${name} 依赖"
  fi
}

# 探测 Vite 是否已在监听。
vite_ready() {
  curl -sf --max-time 1 "${VITE_URL}" >/dev/null 2>&1
}

# 等待 URL 就绪。
wait_url() {
  local url="$1" label="$2" timeout_sec="${3:-60}"
  local deadline=$((SECONDS + timeout_sec))
  while (( SECONDS < deadline )); do
    if curl -sf --max-time 1 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.4
  done
  die "${label} 在 ${timeout_sec}s 内未就绪：${url}"
}

cleanup() {
  local code=$?
  if [[ -n "${VITE_PID}" ]] && kill -0 "${VITE_PID}" 2>/dev/null; then
    info "停止本脚本拉起的 Vite（pid=${VITE_PID}）…"
    kill "${VITE_PID}" 2>/dev/null || true
    wait "${VITE_PID}" 2>/dev/null || true
  fi
  exit "${code}"
}
trap cleanup EXIT INT TERM

info "仓库根目录：${ROOT_DIR}"
info "渲染地址：${VITE_URL}"
warn "请勿同时运行 scripts/start.sh（端口 8080 / 5173 会冲突）"

ensure_deps "${WEB_DIR}" "web"
ensure_deps "${DESKTOP_DIR}" "desktop"

if vite_ready; then
  ok "检测到已有 Vite，直接复用 ${VITE_URL}"
else
  info "启动 Vite（web HMR）…"
  (
    cd "${WEB_DIR}"
    npm run dev -- --host 127.0.0.1 --port 5173
  ) &
  VITE_PID=$!
  wait_url "${VITE_URL}" "Vite"
  ok "Vite 已就绪（pid=${VITE_PID}）"
fi

# 8080 被其它进程占用时给出提示（dev-runner 将拒绝重复启动）
if curl -sf --max-time 1 "http://127.0.0.1:8080/health" >/dev/null 2>&1; then
  warn "127.0.0.1:8080 已有健康后端；若不是本次 Electron 拉起的，可能发生端口冲突"
fi

export ATOLLA_ELECTRON_RENDERER_URL="${VITE_URL}"
export ATOLLA_ELECTRON_OPEN_DEVTOOLS="${OPEN_DEVTOOLS}"

info "将开发态 Electron.app 显示名改为 Atolla…"
( cd "${DESKTOP_DIR}" && node scripts/patch-electron-app-name.mjs )

info "启动 Electron 开发运行器…"
ok "改 web/ → Vite HMR；改 desktop/main|preload|runtime → 自动 relaunch"
if [[ "${WATCH_GO}" == "1" ]]; then
  ok "已开 --watch-go：改 server/*.go 只重启 Go 后端"
fi

# 前台阻塞；Ctrl+C 会触发 trap 清理 Vite
if [[ "${WATCH_GO}" == "1" ]]; then
  ( cd "${DESKTOP_DIR}" && node scripts/dev-runner.mjs --watch-go )
else
  ( cd "${DESKTOP_DIR}" && node scripts/dev-runner.mjs )
fi
