#!/usr/bin/env bash
# 写入 ~/.atolla/island.json，让灵动岛连上你的 Atolla 后端。
# 推荐仍用「管理台登录自动同步」；本脚本供纯预编译安装、不方便走网页时使用。
set -euo pipefail

CFG_DIR="${HOME}/.atolla"
CFG="${CFG_DIR}/island.json"
mkdir -p "$CFG_DIR"

API_BASE="${ATOLLA_API_BASE:-http://127.0.0.1:8080}"
WEB_BASE="${ATOLLA_WEB_BASE:-http://127.0.0.1:5173}"
TOKEN="${ATOLLA_TOKEN:-}"

# 交互补全（非交互环境请用环境变量）
if [[ -z "$TOKEN" ]]; then
  if [[ -t 0 ]]; then
    echo "配置灵动岛凭证（写入 $CFG）"
    read -r -p "API 地址 [$API_BASE]: " in_api
    read -r -p "管理台 Web 地址 [$WEB_BASE]: " in_web
    read -r -p "管理台 Token（登录后 localStorage / 接口返回）: " in_tok
    [[ -n "${in_api:-}" ]] && API_BASE="$in_api"
    [[ -n "${in_web:-}" ]] && WEB_BASE="$in_web"
    TOKEN="${in_tok:-}"
  fi
fi

if [[ -z "$TOKEN" ]]; then
  echo "错误: 缺少 Token。请设置 ATOLLA_TOKEN，或登录管理台让系统自动同步。" >&2
  exit 1
fi

# localhost → 127.0.0.1，避免 IPv6 白名单 403
API_BASE="${API_BASE//localhost/127.0.0.1}"
WEB_BASE="${WEB_BASE//localhost/127.0.0.1}"
UPDATED="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# 用 python3 写 JSON，避免手工转义
python3 - "$CFG" "$API_BASE" "$WEB_BASE" "$TOKEN" "$UPDATED" <<'PY'
import json, sys
path, api, web, token, updated = sys.argv[1:6]
with open(path, "w", encoding="utf-8") as f:
    json.dump(
        {"api_base": api, "web_base": web, "token": token, "updated_at": updated},
        f,
        ensure_ascii=False,
        indent=2,
    )
    f.write("\n")
print("==> 已写入", path)
PY

echo "    api_base=$API_BASE"
echo "    web_base=$WEB_BASE"
echo "若岛已在跑，稍等几秒应开始轮询忙碌数字人；否则重新执行 install。"
