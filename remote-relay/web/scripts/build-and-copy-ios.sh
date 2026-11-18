#!/usr/bin/env bash
# 构建 remote-relay Web 并拷贝到 iOS App/public，供 Xcode 重新编译。
# 用法（在任意目录）:
#   ./scripts/build-and-copy-ios.sh
# 或:
#   npm run cap:copy
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> build web (cwd: $ROOT)"
npm run build

echo "==> cap copy ios → ios/App/App/public"
npx cap copy ios

PUBLIC_DIR="$ROOT/ios/App/App/public"
if [[ ! -f "$PUBLIC_DIR/index.html" ]]; then
  echo "error: missing $PUBLIC_DIR/index.html" >&2
  exit 1
fi

echo "==> done: $PUBLIC_DIR"
ls -la "$PUBLIC_DIR/index.html" "$PUBLIC_DIR/assets" 2>/dev/null | head -20
