#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

node -e 'JSON.parse(require("node:fs").readFileSync("browser-extension/manifest.json", "utf8"))'
for file in browser-extension/*.mjs browser-extension/lib/*.mjs browser-extension/adapters/*.mjs; do
  node --check "$file"
done
node --test browser-extension/tests/*.test.mjs

OUT_DIR="${ATOLLA_BROWSER_EXTENSION_OUT:-dist/browser-extension}"
mkdir -p "$OUT_DIR" dist
cp -R browser-extension/. "$OUT_DIR"/
(cd dist && zip -q -r browser-extension.zip browser-extension -x 'browser-extension/tests/*' 'browser-extension/test-fixture/*' 'browser-extension/local-config.json')

echo "Chrome 扩展构建完成：$OUT_DIR"
echo "压缩包：dist/browser-extension.zip"
