#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Go 单元测试"
(cd server && go test ./internal/browsercontrol ./internal/handler)
echo "==> 扩展构建与协议测试"
./scripts/build-browser-extension.sh

if [ "${1:-}" != "--chrome" ]; then
  echo "==> 已完成非浏览器测试；传 --chrome 可使用 Chrome for Testing 执行端到端测试"
  exit 0
fi
RUN_SCREENSHOT=0
if [ "${2:-}" = "--screenshot" ]; then RUN_SCREENSHOT=1; fi

CHROME_BIN="${CHROME_FOR_TESTING_BIN:-}"
if [ -z "$CHROME_BIN" ]; then
  for candidate in \
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [ -x "$candidate" ]; then CHROME_BIN="$candidate"; break; fi
  done
fi
if [ ! -x "$CHROME_BIN" ]; then
  echo "未找到 Chrome for Testing；请设置 CHROME_FOR_TESTING_BIN" >&2
  exit 1
fi

TOKEN="$(openssl rand -hex 32)"
free_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}
API_PORT="${ATOLLA_BROWSER_TEST_API_PORT:-$(free_port)}"
PAGE_PORT="${ATOLLA_BROWSER_TEST_PAGE_PORT:-$(free_port)}"
while [ "$PAGE_PORT" = "$API_PORT" ]; do PAGE_PORT="$(free_port)"; done
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/atolla-browser-test.XXXXXX")"
EXT_DIR="$TMP_ROOT/extension"
PROFILE_DIR="$TMP_ROOT/profile"
mkdir -p "$EXT_DIR" "$PROFILE_DIR" "$TMP_ROOT/data"
cp -R browser-extension/. "$EXT_DIR"/
printf '{"backendUrl":"http://127.0.0.1:%s","token":"%s"}\n' "$API_PORT" "$TOKEN" > "$EXT_DIR/local-config.json"

BACKEND_PID=""
PAGE_PID=""
CHROME_PID=""
cleanup() {
  [ -z "$CHROME_PID" ] || kill "$CHROME_PID" 2>/dev/null || true
  [ -z "$PAGE_PID" ] || kill "$PAGE_PID" 2>/dev/null || true
  [ -z "$BACKEND_PID" ] || kill "$BACKEND_PID" 2>/dev/null || true
  echo "测试临时目录保留在：$TMP_ROOT"
}
trap cleanup EXIT

# 直接运行测试二进制，cleanup 可以准确终止进程；避免 go run 遗留子进程占用端口。
(cd server && go build -o "$TMP_ROOT/atolla-browser-test-server" .)
(
  cd server
  export AVATAR_ADDR="127.0.0.1:$API_PORT"
  export AVATAR_DB_DRIVER=sqlite
  export AVATAR_DB_DSN="$TMP_ROOT/data/atolla.db"
  export AVATAR_ALLOWED_IPS="127.0.0.1,::1"
  export AVATAR_BROWSER_TOKEN="$TOKEN"
  export AVATAR_BROWSER_ALLOWED_DOMAINS="localhost,127.0.0.1"
  export AVATAR_BROWSER_ALLOW_REMOTE=0
  exec "$TMP_ROOT/atolla-browser-test-server"
) >"$TMP_ROOT/backend.log" 2>&1 &
BACKEND_PID=$!
(
  cd browser-extension/test-fixture
  exec python3 -m http.server "$PAGE_PORT" --bind 127.0.0.1
) >"$TMP_ROOT/page.log" 2>&1 &
PAGE_PID=$!

"$CHROME_BIN" \
  --user-data-dir="$PROFILE_DIR" \
  --disable-extensions-except="$EXT_DIR" \
  --load-extension="$EXT_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "http://127.0.0.1:$PAGE_PORT" >"$TMP_ROOT/chrome.log" 2>&1 &
CHROME_PID=$!

AUTH_HEADER="Authorization: Bearer $TOKEN"
for _ in {1..60}; do
  if curl -fsS -H "$AUTH_HEADER" "http://127.0.0.1:$API_PORT/api/browser/status" 2>/dev/null | grep -q '"connected":true'; then
    break
  fi
  sleep 1
done
if ! curl -fsS -H "$AUTH_HEADER" "http://127.0.0.1:$API_PORT/api/browser/status" | grep -q '"connected":true'; then
  echo "Chrome 扩展未连接，日志目录：$TMP_ROOT" >&2
  tail -30 "$TMP_ROOT/backend.log" >&2 || true
  tail -30 "$TMP_ROOT/chrome.log" >&2 || true
  exit 1
fi

call_browser() {
  curl -fsS -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
    -X POST "http://127.0.0.1:$API_PORT/api/browser/tasks" -d "$1"
}

OPEN_RESULT="$(call_browser "{\"action\":\"tabs.open\",\"params\":{\"url\":\"http://127.0.0.1:$PAGE_PORT\",\"active\":true}}")"
TAB_ID="$(printf '%s' "$OPEN_RESULT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["tab"]["id"])')"
call_browser "{\"action\":\"dom.input\",\"params\":{\"tab_id\":$TAB_ID,\"selector\":\"#name\",\"text\":\"Atolla\"}}" | grep -q '"ok":true'
call_browser "{\"action\":\"dom.click\",\"params\":{\"tab_id\":$TAB_ID,\"selector\":\"#apply\"}}" | grep -q '"ok":true'
READ_RESULT="$(call_browser "{\"action\":\"dom.read\",\"params\":{\"tab_id\":$TAB_ID,\"selector\":\"#output\"}}")"
printf '%s' "$READ_RESULT" | grep -q '已输入：Atolla'
if [ "$RUN_SCREENSHOT" = "1" ]; then
  SCREENSHOT_RESULT="$(call_browser "{\"action\":\"page.screenshot\",\"params\":{\"tab_id\":$TAB_ID}}")"
  SCREENSHOT_PATH="$TMP_ROOT/browser-screenshot.png"
  printf '%s' "$SCREENSHOT_RESULT" | python3 -c '
import base64, json, sys
payload = json.load(sys.stdin)["data"]["data_url"]
header, encoded = payload.split(",", 1)
if header != "data:image/png;base64":
    raise SystemExit("unexpected screenshot format: " + header)
with open(sys.argv[1], "wb") as output:
    output.write(base64.b64decode(encoded))
' "$SCREENSHOT_PATH"
  test -s "$SCREENSHOT_PATH"
  echo "==> 截图已保存：$SCREENSHOT_PATH"
  if command -v open >/dev/null 2>&1; then
    open -a Preview "$SCREENSHOT_PATH"
  fi
else
  echo "==> 已跳过可选截图测试；如需验证请追加 --screenshot"
fi

echo "==> Chrome for Testing 端到端测试通过"
