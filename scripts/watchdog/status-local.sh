#!/usr/bin/env bash
# 输出本机守护状态 JSON（供后端 API 调用）。
# 不仅看 plist 是否加载，还看最近探活是否真的跑通（规避 Desktop TCC 假“已加载”）。
set -euo pipefail

LABEL="com.atolla.backend-watchdog"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
STATE_DIR="${HOME}/.atolla/watchdog-local"
LAST_CHECK="$STATE_DIR/last-check"
ERR_LOG="$STATE_DIR/launchd.err.log"
UID_NUM="$(id -u)"
enabled=false
status="inactive"
detail="未安装"
grace=180

json_escape() {
  # shellcheck disable=SC2001
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

loaded=false
if [ -f "$PLIST" ]; then
  if launchctl print "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1 \
    || launchctl list "$LABEL" >/dev/null 2>&1; then
    loaded=true
  fi
fi

# LaunchAgent 实际 ProgramArguments 是否指向家目录副本
plist_uses_home=false
if [ -f "$PLIST" ] && grep -q "${STATE_DIR}/local-check.sh" "$PLIST" 2>/dev/null; then
  plist_uses_home=true
fi

last_exit=""
if $loaded; then
  last_exit="$(launchctl print "gui/${UID_NUM}/${LABEL}" 2>/dev/null \
    | sed -n 's/.*last exit code = //p' | head -1 | tr -d '[:space:]' || true)"
fi

# 解析 last-check
check_ok=""
check_ts=""
check_msg=""
if [ -f "$LAST_CHECK" ]; then
  # shellcheck disable=SC1090
  check_ok="$(sed -n 's/^ok=//p' "$LAST_CHECK" | head -1)"
  check_ts="$(sed -n 's/^ts=//p' "$LAST_CHECK" | head -1)"
  check_msg="$(sed -n 's/^msg=//p' "$LAST_CHECK" | head -1)"
fi

now="$(date +%s)"
check_age=""
if [[ "${check_ts:-}" =~ ^[0-9]+$ ]]; then
  check_age=$((now - check_ts))
fi

# 最近 err 是否仍是 TCC/权限问题
tcc_noise=false
if [ -f "$ERR_LOG" ] && [ -s "$ERR_LOG" ]; then
  if tail -n 5 "$ERR_LOG" 2>/dev/null | grep -q 'Operation not permitted'; then
    tcc_noise=true
  fi
fi

if [ ! -f "$PLIST" ]; then
  enabled=false
  status="inactive"
  detail="未安装"
elif ! $loaded; then
  enabled=false
  status="inactive"
  detail="plist 存在但未加载"
elif [ "$last_exit" = "126" ] || [ "$last_exit" = "127" ] || $tcc_noise; then
  # 已加载但探活脚本执行失败（常见：旧版指向 Desktop 仓库脚本）
  enabled=true
  status="error"
  if ! $plist_uses_home; then
    detail="LaunchAgent 已加载但探活脚本无法执行(exit ${last_exit:-?})。请关闭再开启本开关以重装到 ~/.atolla（避免 Desktop TCC）"
  else
    detail="LaunchAgent 已加载但探活失败(exit ${last_exit:-?}/Operation not permitted)。请检查隐私权限或重新开关守护"
  fi
elif [ -n "$check_ts" ] && [ "${check_age:-9999}" -le 180 ]; then
  # 近 3 分钟内有成功写入的探活记录 → 守护真正在工作
  enabled=true
  status="active"
  if [ "$check_ok" = "1" ]; then
    detail="探活正常（${check_age}s 前）"
  else
    detail="探活运行中：${check_msg:-unhealthy}"
  fi
elif $plist_uses_home && [ -x "$STATE_DIR/local-check.sh" ]; then
  enabled=true
  status="active"
  detail="LaunchAgent 已加载（家目录探活副本）；等待下一轮 60s 探活"
else
  enabled=true
  status="active"
  detail="LaunchAgent 已加载"
fi

printf '{"enabled":%s,"status":"%s","detail":"%s","grace_sec":%s}\n' \
  "$enabled" "$(json_escape "$status")" "$(json_escape "$detail")" "$grace"
