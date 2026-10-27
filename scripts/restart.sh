#!/usr/bin/env bash
# 重启 Atolla 前后端（默认 SQLite；若环境已设 AVATAR_DB_DRIVER=mysql 则沿用）
# 用法: scripts/restart.sh
set -e
cd "$(dirname "$0")/.."

echo "==> 重启前后端"
"$(dirname "$0")/shutdown.sh"
sleep 1
# 透传参数（如 --mysql）
exec "$(dirname "$0")/start.sh" "$@"
