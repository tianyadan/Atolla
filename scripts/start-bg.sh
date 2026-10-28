#!/usr/bin/env bash
# 后台启动 Atolla（前后端），可关闭终端。
# 用法:
#   scripts/start-bg.sh
#   scripts/start-bg.sh --mysql
# 停止: scripts/shutdown.sh
# 日志: logs/backend.log  logs/frontend.log
set -e
exec "$(dirname "$0")/start.sh" --daemon "$@"
