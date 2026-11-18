#!/usr/bin/env bash
# 重启 Atolla 前后端（默认 SQLite；若环境已设 AVATAR_DB_DRIVER=mysql 则沿用）
# 用法:
#   scripts/restart.sh
#   scripts/restart.sh --daemon          # 重启后后台跑（可关终端）
#   scripts/restart.sh --mysql --daemon
set -e
cd "$(dirname "$0")/.."

echo "==> 重启前后端"
"$(dirname "$0")/shutdown.sh"
sleep 1
# 透传参数（如 --mysql / --daemon）
exec "$(dirname "$0")/start.sh" "$@"
