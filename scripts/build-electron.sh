#!/usr/bin/env bash
#
# Atolla Electron macOS 打包脚本（Apple Silicon / arm64）
#
# 用法：
#   ./scripts/build-electron.sh                  # 构建 DMG
#   ./scripts/build-electron.sh --version 0.6.8  # 先写入版本号再构建
#   ./scripts/build-electron.sh --clean-install  # 强制 npm ci 重装依赖
#   ./scripts/build-electron.sh --skip-test      # 跳过 desktop 运行时测试
#   ./scripts/build-electron.sh --official-registry  # 不用 npmmirror，走官方源
#   ./scripts/build-electron.sh --help
#
# 脚本内所有路径都基于脚本自身所在位置解析，因此可以在任意目录执行，
# 也可以直接上传到 GitHub 由 CI 调用（只需脚本 + 仓库本身，不依赖任何本机绝对路径）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WEB_DIR="${ROOT_DIR}/web"
DESKTOP_DIR="${ROOT_DIR}/desktop"
OUTPUT_DIR="${ROOT_DIR}/dist/electron"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  awk 'NR > 2 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

# ---------- 参数解析 ----------
VERSION=""
CLEAN_INSTALL=0
SKIP_TEST=0
USE_MIRROR=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || die "--version 需要一个版本号，例如 0.6.8"
      VERSION="$2"
      shift 2
      ;;
    --clean-install)
      CLEAN_INSTALL=1
      shift
      ;;
    --skip-test)
      SKIP_TEST=1
      shift
      ;;
    --official-registry)
      USE_MIRROR=0
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

# ---------- 环境检查 ----------
[[ -f "${DESKTOP_DIR}/package.json" ]] || die "找不到 ${DESKTOP_DIR}/package.json，脚本可能不在仓库的 scripts/ 目录下"
[[ -f "${DESKTOP_DIR}/electron-builder.yml" ]] || die "找不到 electron-builder 配置"
[[ -f "${WEB_DIR}/package-lock.json" ]] || die "找不到 web/package-lock.json（npm ci 需要锁文件）"
[[ -f "${DESKTOP_DIR}/package-lock.json" ]] || die "找不到 desktop/package-lock.json（npm ci 需要锁文件）"

command -v node >/dev/null 2>&1 || die "未安装 Node.js（需要 20 或更高版本）"
command -v npm  >/dev/null 2>&1 || die "未安装 npm"
command -v go   >/dev/null 2>&1 || die "未安装 Go（server/go.mod 声明 go 1.26.5）"

[[ "$(uname -s)" == "Darwin" ]] || die "该脚本只支持在 macOS 上构建（当前系统：$(uname -s)）"
if [[ "$(uname -m)" != "arm64" ]]; then
  warn "当前架构为 $(uname -m)，而打包目标是 arm64；构建出的 DMG 只能在 Apple Silicon Mac 上运行"
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "${NODE_MAJOR}" -ge 20 ]] || die "Node.js 版本过低（当前 $(node -v)），需要 20 或更高版本"

# ---------- 版本号（可选） ----------
if [[ -n "${VERSION}" ]]; then
  [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "版本号格式应为 x.y.z，例如 0.6.8"
  info "写入 desktop/package.json 版本号：${VERSION}"
  DESKTOP_VERSION="${VERSION}" node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const file = path.join(process.argv[1], "package.json");
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    pkg.version = process.env.DESKTOP_VERSION;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  ' "${DESKTOP_DIR}"
fi

PKG_VERSION="$(node -p 'require(process.argv[1]).version' "${DESKTOP_DIR}/package.json")"

info "仓库根目录：${ROOT_DIR}"
info "App 版本：${PKG_VERSION}（来自 desktop/package.json）"
info "构建目标：macOS arm64"

# ---------- 国内镜像（npm + Electron 二进制） ----------
# desktop/.npmrc / web/.npmrc 已默认指向 npmmirror；此处再导出环境变量，
# 覆盖 electron postinstall 与 electron-builder 下载（常卡在 GitHub）。
if [[ "${USE_MIRROR}" == "1" ]]; then
  export npm_config_registry="${npm_config_registry:-https://registry.npmmirror.com}"
  export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
  export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"
  info "使用镜像：npm=${npm_config_registry}"
  info "使用镜像：ELECTRON_MIRROR=${ELECTRON_MIRROR}"
else
  info "使用官方源（--official-registry）"
fi

# ---------- 依赖安装 ----------
install_deps() {
  local dir="$1" name="$2"
  if [[ "${CLEAN_INSTALL}" == "1" || ! -d "${dir}/node_modules" ]]; then
    info "安装 ${name} 依赖（npm ci）..."
    ( cd "${dir}" && npm ci )
  else
    info "复用已有 ${name} 依赖（需要重装请加 --clean-install）"
  fi
}

install_deps "${WEB_DIR}" "web"
install_deps "${DESKTOP_DIR}" "desktop"

# ---------- 测试（可选） ----------
if [[ "${SKIP_TEST}" != "1" ]]; then
  info "运行 desktop 运行时测试..."
  ( cd "${DESKTOP_DIR}" && npm test )
fi

# ---------- 打包 ----------
# npm run package 会依次执行：
#   build:web       vite build → web/dist
#   build:backend   go build（darwin/arm64）→ desktop/stage/bin/atolla-server
#   prepare:resources  把 web/dist 与后端二进制放进 desktop/stage
#   verify:resources   校验产物存在且可执行
#   electron-builder   生成 dist/electron/*.dmg
info "开始打包（web 构建 → 后端编译 → electron-builder）..."
(
  cd "${DESKTOP_DIR}"
  CSC_IDENTITY_AUTO_DISCOVERY=false npm run package
)

# ---------- 结果校验 ----------
[[ -d "${OUTPUT_DIR}" ]] || die "打包完成但未找到输出目录：${OUTPUT_DIR}"

shopt -s nullglob
dmg_files=("${OUTPUT_DIR}"/*.dmg)
shopt -u nullglob

[[ ${#dmg_files[@]} -gt 0 ]] || die "打包完成但未生成 DMG，请检查上面的 electron-builder 输出"

echo
ok "构建完成，产物如下："
for f in "${dmg_files[@]}"; do
  printf '  %s  (%s)\n' "${f}" "$(du -h "${f}" | cut -f1)"
  printf '  sha256: %s\n' "$(shasum -a 256 "${f}" | cut -d' ' -f1)"
done
printf '  输出目录: %s\n' "${OUTPUT_DIR}"

if [[ -d "${OUTPUT_DIR}/mac-arm64/Atolla.app" ]]; then
  printf '  未压缩 App: %s\n' "${OUTPUT_DIR}/mac-arm64/Atolla.app"
fi

echo
warn "当前为未签名、未公证的 DMG：首次打开需右键 → 打开，或执行"
warn "  xattr -dr com.apple.quarantine /Applications/Atolla.app"
