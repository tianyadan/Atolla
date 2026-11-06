#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# 与 scripts/start.sh 一致，优先复用 .env 中已有 Token，避免打印值与后端实际值不一致。
if [ -z "${AVATAR_BROWSER_TOKEN:-}" ] && [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      AVATAR_BROWSER_TOKEN=*)
        value="${line#*=}"
        if [ "${#value}" -ge 2 ]; then
          case "$value" in
            \'*\') value="${value:1:${#value}-2}" ;;
            \"*\") value="${value:1:${#value}-2}" ;;
          esac
        fi
        AVATAR_BROWSER_TOKEN="$value"
        export AVATAR_BROWSER_TOKEN
        break
        ;;
    esac
  done < .env
fi

if [ -z "${AVATAR_BROWSER_TOKEN:-}" ]; then
  if command -v openssl >/dev/null 2>&1; then
    AVATAR_BROWSER_TOKEN="$(openssl rand -hex 32)"
  else
    AVATAR_BROWSER_TOKEN="$(date +%s)-atolla-browser-local-token"
  fi
  export AVATAR_BROWSER_TOKEN
fi
export AVATAR_BROWSER_ALLOWED_DOMAINS="${AVATAR_BROWSER_ALLOWED_DOMAINS:-localhost,127.0.0.1,chatgpt.com,chat.openai.com}"
export AVATAR_BROWSER_ALLOW_REMOTE="${AVATAR_BROWSER_ALLOW_REMOTE:-0}"

./scripts/build-browser-extension.sh
echo ""
echo "Browser Token（粘贴到扩展设置）：$AVATAR_BROWSER_TOKEN"
echo "Chrome 加载目录：$(pwd)/dist/browser-extension"
echo ""
exec ./scripts/start.sh "$@"
