# shellcheck shell=bash
# 中继守护脚本共用：补齐 PATH/sshpass，短 ControlPath（避免 macOS Unix socket 路径过长）。
# 调用方需先设置：HOST USER SSH_PORT
# 可选：ATOLLA_SSH_PASSWORD

# 保证 brew 的 sshpass 可被找到（Go 后端启动时 PATH 往往很短）
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
for _sshp in /opt/homebrew/bin/sshpass /usr/local/bin/sshpass; do
  if [[ -x "$_sshp" ]]; then
    export PATH="$(dirname "$_sshp"):$PATH"
    break
  fi
done
unset _sshp

WATCHDOG_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../lib-ssh.sh
source "$WATCHDOG_DEPLOY_DIR/lib-ssh.sh"

# 覆盖清理：归档临时文件，不用 rm
cleanup_ssh_auth_files() {
  if [[ -n "${ASKPASS_FILE:-}" && -f "$ASKPASS_FILE" ]]; then
    mv "$ASKPASS_FILE" "${ASKPASS_FILE}.off.$$" 2>/dev/null || true
  fi
  if [[ -n "${PASS_FILE:-}" && -f "$PASS_FILE" ]]; then
    mv "$PASS_FILE" "${PASS_FILE}.off.$$" 2>/dev/null || true
  fi
  ASKPASS_FILE=""
  PASS_FILE=""
  unset SSHPASS 2>/dev/null || true
  unset SSH_ASKPASS SSH_ASKPASS_REQUIRE 2>/dev/null || true
}

WATCHDOG_CTRL_DIR=""
watchdog_ssh_cleanup() {
  if [[ -n "${CTRL_PATH:-}" && -n "${HOST:-}" ]]; then
    ssh -O exit -o ControlPath="$CTRL_PATH" -p "${SSH_PORT:-22}" "${USER}@${HOST}" 2>/dev/null || true
  fi
  cleanup_ssh_auth_files
  if [[ -n "${CTRL_PATH:-}" && -e "${CTRL_PATH}" ]]; then
    mv "${CTRL_PATH}" "${CTRL_PATH}.off.$$" 2>/dev/null || true
  fi
  if [[ -n "${WATCHDOG_CTRL_DIR:-}" && -d "${WATCHDOG_CTRL_DIR}" ]]; then
    mv "${WATCHDOG_CTRL_DIR}" "${WATCHDOG_CTRL_DIR}.off.$$" 2>/dev/null || true
  fi
}

# 初始化 SSH 数组并打开 ControlMaster；失败时打印可读原因并返回非 0
watchdog_ssh_init() {
  if [[ -z "${HOST:-}" ]]; then
    echo "watchdog_ssh_init: HOST empty" >&2
    return 2
  fi
  USER="${USER:-root}"
  SSH_PORT="${SSH_PORT:-22}"

  if [[ -n "${ATOLLA_SSH_PASSWORD:-}" ]] && ! command -v sshpass >/dev/null 2>&1; then
    echo "ERROR: 已提供 SSH 密码，但未找到 sshpass（请 brew install hudochenkov/sshpass/sshpass）" >&2
    return 127
  fi

  # 关键：绝不能用过长的 TMPDIR（macOS /var/folders/... 会导致 ControlPath 超 Unix socket 上限 → SSH 255）
  WATCHDOG_CTRL_DIR="$(mktemp -d /tmp/awd.XXXXXX)"
  CTRL_PATH="${WATCHDOG_CTRL_DIR}/c.sock"
  SSH_BASE=(
    -p "$SSH_PORT"
    -o ControlMaster=auto
    -o ControlPath="$CTRL_PATH"
    -o ControlPersist=5m
    -o ConnectTimeout=20
  )
  setup_ssh_auth
  build_ssh_cmd
  trap watchdog_ssh_cleanup EXIT

  local master_log
  master_log="$(mktemp /tmp/awd-ssh.XXXXXX)"
  set +e
  "${SSH_PREFIX[@]}" ssh "${SSH_BASE[@]}" -o ControlMaster=yes "${USER}@${HOST}" true >"$master_log" 2>&1
  local ec=$?
  set -e
  if [[ "$ec" -ne 0 ]]; then
    echo "==> Opening SSH session to ${USER}@${HOST} FAILED (exit ${ec})" >&2
    cat "$master_log" >&2 || true
    if grep -q 'too long for Unix domain socket' "$master_log" 2>/dev/null; then
      echo "ERROR: SSH ControlPath 过长（macOS 限制）。请升级 watchdog-ssh.sh 使用 /tmp 短路径。" >&2
    elif [[ -n "${ATOLLA_SSH_PASSWORD:-}" ]]; then
      echo "ERROR: SSH 密码认证失败，请核对主机 ${USER}@${HOST}:${SSH_PORT} 与密码。" >&2
    else
      echo "ERROR: SSH 失败（未提供密码且密钥不可用）。请在设置中填写 SSH 密码。" >&2
    fi
    mv "$master_log" "${master_log}.off" 2>/dev/null || true
    return "$ec"
  fi
  # 二次确认 master 可用
  if ! "${SSH[@]}" true >/dev/null 2>&1; then
    echo "ERROR: SSH ControlMaster 已建立但复用失败" >&2
    cat "$master_log" >&2 || true
    mv "$master_log" "${master_log}.off" 2>/dev/null || true
    return 255
  fi
  echo "==> SSH OK ${USER}@${HOST} (control=$(basename "$WATCHDOG_CTRL_DIR"))"
  mv "$master_log" "${master_log}.off" 2>/dev/null || true
  return 0
}
