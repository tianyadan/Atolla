#!/usr/bin/env bash
# 数字人 Bark 卡片：标题 + 一行正文 + 可选头像，不附带项目/命令 JSON。
#
# 用法:
#   scripts/notify-bark-card.sh "员工名" "有一条命令待审批" "https://.../a.jpg"
set -euo pipefail

TITLE="${1:-数字员工}"
BODY="${2:-有一条命令待审批}"
ICON="${3:-}"
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

if [[ -n "$ICON" ]]; then
  PAYLOAD=$(jq -n \
    --arg key "$BARK_KEY" \
    --arg title "$TITLE" \
    --arg body "$BODY" \
    --arg icon "$ICON" \
    --arg group "$TITLE" \
    '{device_key:$key, title:$title, body:$body, icon:$icon, group:$group}')
else
  PAYLOAD=$(jq -n \
    --arg key "$BARK_KEY" \
    --arg title "$TITLE" \
    --arg body "$BODY" \
    --arg group "$TITLE" \
    '{device_key:$key, title:$title, body:$body, group:$group}')
fi

RESPONSE=$(curl -s -X POST "$NOTIFY_URL" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "$PAYLOAD")

echo "$RESPONSE"
echo "$RESPONSE" | grep -q '"code":200'
