#!/usr/bin/env bash
# Atolla Bark 卡片：品牌标题 + 摘要 + App 图标 + 可选应用深链。
#
# 用法:
#   scripts/notify-bark-card.sh "标题" "正文" "https://.../app.png" "Atolla" "atolla://..." "alarm" "timeSensitive"
set -euo pipefail

TITLE="${1:-Atolla}"
BODY="${2:-有一条通知}"
ICON="${3:-}"
GROUP="${4:-Atolla}"
URL="${5:-}"
SOUND="${6:-}"
LEVEL="${7:-active}"
NOTIFY_URL="https://api.day.app/push"

if [[ -z "${BARK_KEY:-}" ]]; then
  for f in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bashrc" "$HOME/.profile"; do
    if [[ -f "$f" ]]; then
      k=$(grep -E '^\s*(export\s+)?BARK_KEY=' "$f" | tail -1 | sed -E 's/.*(BARK_KEY=)//; s/^["'\'']//; s/["'\'']$//; s/\s*$//' || true)
      if [[ -n "${k:-}" ]]; then
        export BARK_KEY="$k"
        break
      fi
    fi
  done
fi

if [[ -z "${BARK_KEY:-}" ]]; then
  echo "ERROR: BARK_KEY 未设置" >&2
  exit 1
fi

PAYLOAD=$(jq -n \
  --arg key "$BARK_KEY" \
  --arg title "$TITLE" \
  --arg body "$BODY" \
  --arg icon "$ICON" \
  --arg group "$GROUP" \
  --arg url "$URL" \
  --arg sound "$SOUND" \
  --arg level "$LEVEL" \
  '{device_key:$key, title:$title, body:$body, group:$group}
   + (if $icon == "" then {} else {icon:$icon} end)
   + (if $url == "" then {} else {url:$url} end)
   + (if $sound == "" then {} else {sound:$sound} end)
   + (if $level == "" then {} else {level:$level} end)')

RESPONSE=$(curl -s -X POST "$NOTIFY_URL" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "$PAYLOAD")

echo "$RESPONSE"
echo "$RESPONSE" | grep -q '"code":200'
