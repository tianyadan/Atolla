#!/usr/bin/env bash
# 远端中继守护：探 /api/health，连续不健康满 GRACE_SEC 才 systemctl restart。
# 由 systemd timer 约每 60s 调用。
set -euo pipefail

ENV_FILE="${ATOLLA_RELAY_ENV:-/etc/atolla-remote-relay.env}"
PORT=3080
if [ -f "$ENV_FILE" ]; then
  # 只读 PORT=，避免 source 整文件副作用
  line="$(grep -E '^[[:space:]]*PORT=' "$ENV_FILE" 2>/dev/null | tail -1 || true)"
  if [[ "$line" =~ PORT=([0-9]+) ]]; then
    PORT="${BASH_REMATCH[1]}"
  fi
fi

HEALTH="http://127.0.0.1:${PORT}/api/health"
GRACE_SEC="${ATOLLA_RELAY_WATCHDOG_GRACE_SEC:-300}"
STATE_DIR="${ATOLLA_RELAY_WATCHDOG_STATE:-/var/lib/atolla-relay-watchdog}"
STATE_FILE="$STATE_DIR/down-since"
UNIT="${ATOLLA_RELAY_SYSTEMD_UNIT:-atolla-remote-relay.service}"

mkdir -p "$STATE_DIR"
now="$(date +%s)"

if curl -sf --max-time 5 "$HEALTH" >/dev/null 2>&1; then
  : >"$STATE_FILE"
  exit 0
fi

if [ ! -s "$STATE_FILE" ]; then
  printf '%s' "$now" >"$STATE_FILE"
  echo "==> relay unhealthy, start grace (${GRACE_SEC}s) port=${PORT}"
  exit 0
fi

since="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
if ! [[ "$since" =~ ^[0-9]+$ ]]; then
  printf '%s' "$now" >"$STATE_FILE"
  exit 0
fi

elapsed=$((now - since))
if [ "$elapsed" -lt "$GRACE_SEC" ]; then
  echo "==> relay unhealthy ${elapsed}s / ${GRACE_SEC}s"
  exit 0
fi

echo "==> grace elapsed (${elapsed}s), restart ${UNIT}"
systemctl restart "$UNIT" || true
printf '%s' "$now" >"$STATE_FILE"
exit 0
