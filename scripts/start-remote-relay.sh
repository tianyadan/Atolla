#!/usr/bin/env bash
# 仓库根入口：本机一键启动 remote-relay（转发到 remote-relay/scripts/dev-local.sh）
# 用法同: remote-relay/scripts/dev-local.sh [--api] [--fresh]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/remote-relay/scripts/dev-local.sh" "$@"
