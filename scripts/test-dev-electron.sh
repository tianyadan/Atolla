#!/usr/bin/env bash
# 验证默认开发模式在 Bash 3.2 + set -u 下可启动运行器。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOCK_BIN="$(mktemp -d)"

cleanup() {
  rm -rf "${MOCK_BIN}"
}
trap cleanup EXIT

# Vite 与健康检查均视为已就绪，避免测试启动真实服务。
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "${MOCK_BIN}/curl"
# 避免测试修改 Electron.app 或实际启动 Electron。
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "${MOCK_BIN}/node"
chmod +x "${MOCK_BIN}/curl" "${MOCK_BIN}/node"

PATH="${MOCK_BIN}:${PATH}" bash "${SCRIPT_DIR}/dev-electron.sh" >/dev/null
