# shellcheck shell=bash
# Shared SSH helpers for install.sh / upgrade.sh.
# Expects: SSH_PORT, USER, HOST, CTRL_PATH already set.
# Optional env: ATOLLA_SSH_PASSWORD, ATOLLA_DEPLOY_NONINTERACTIVE

SSH_PREFIX=()
ASKPASS_FILE=""
PASS_FILE=""

cleanup_ssh_auth_files() {
  [[ -n "${ASKPASS_FILE:-}" && -f "$ASKPASS_FILE" ]] && rm -f "$ASKPASS_FILE"
  [[ -n "${PASS_FILE:-}" && -f "$PASS_FILE" ]] && rm -f "$PASS_FILE"
  ASKPASS_FILE=""
  PASS_FILE=""
  unset SSHPASS 2>/dev/null || true
  unset SSH_ASKPASS SSH_ASKPASS_REQUIRE 2>/dev/null || true
}

# Populate SSH_BASE auth options + SSH_PREFIX (sshpass). Call once before building SSH/RSYNC arrays.
setup_ssh_auth() {
  cleanup_ssh_auth_files
  SSH_BASE+=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)

  if [[ -n "${ATOLLA_SSH_PASSWORD:-}" ]]; then
    echo "==> SSH: password auth (non-interactive)"
    # 禁用本机默认密钥，避免先耗尽远端 MaxAuthTries 导致密码根本没机会
    SSH_BASE+=(
      -o PreferredAuthentications=password,keyboard-interactive
      -o PubkeyAuthentication=no
      -o IdentitiesOnly=yes
      -o IdentityAgent=none
      -o NumberOfPasswordPrompts=1
    )
    if command -v sshpass >/dev/null 2>&1; then
      export SSHPASS="$ATOLLA_SSH_PASSWORD"
      SSH_PREFIX=(sshpass -e)
      echo "==> using sshpass"
    else
      PASS_FILE="$(mktemp "${TMPDIR:-/tmp}/atolla-ssh-pass.XXXXXX")"
      ASKPASS_FILE="$(mktemp "${TMPDIR:-/tmp}/atolla-ssh-askpass.XXXXXX")"
      # password in file (not argv); askpass only cats the file
      printf '%s' "$ATOLLA_SSH_PASSWORD" >"$PASS_FILE"
      chmod 600 "$PASS_FILE"
      cat >"$ASKPASS_FILE" <<EOF
#!/bin/sh
cat '$PASS_FILE'
EOF
      chmod 700 "$ASKPASS_FILE"
      export SSH_ASKPASS="$ASKPASS_FILE"
      export SSH_ASKPASS_REQUIRE=force
      # some OpenSSH builds still want DISPLAY
      export DISPLAY="${DISPLAY:-:0}"
      SSH_PREFIX=()
      echo "==> using SSH_ASKPASS (install sshpass for more reliable password auth: brew install hudochenkov/sshpass/sshpass)"
    fi
  elif [[ "${ATOLLA_DEPLOY_NONINTERACTIVE:-0}" == "1" ]]; then
    echo "==> SSH: key-only (BatchMode)"
    SSH_BASE+=(-o BatchMode=yes -o PreferredAuthentications=publickey)
    SSH_PREFIX=()
  else
    SSH_PREFIX=()
  fi
}

# Build SSH command array: "${SSH_PREFIX[@]}" ssh "${SSH_BASE[@]}" user@host
build_ssh_cmd() {
  SSH=("${SSH_PREFIX[@]}" ssh "${SSH_BASE[@]}" "${USER}@${HOST}")
}

# Build rsync -e string for the same SSH options
build_rsync_cmd() {
  local ssh_e
  if [[ ${#SSH_PREFIX[@]} -gt 0 ]]; then
    ssh_e="${SSH_PREFIX[*]} ssh ${SSH_BASE[*]}"
  else
    ssh_e="ssh ${SSH_BASE[*]}"
  fi
  RSYNC=(rsync -az --delete
    --exclude node_modules
    --exclude server/data
    --exclude 'server/dist'
    --exclude web/dist
    -e "$ssh_e"
  )
}

# 建立 ControlMaster。注意：sshpass 与 ssh -f 不兼容，因此用远程 true + ControlPersist，绝不用 -fN。
open_ssh_master() {
  echo "==> Opening SSH session to ${USER}@${HOST}"
  if ! "${SSH_PREFIX[@]}" ssh "${SSH_BASE[@]}" -o ControlMaster=yes "${USER}@${HOST}" true; then
    local ec=$?
    echo "SSH auth failed (exit ${ec})." >&2
    if [[ -n "${ATOLLA_SSH_PASSWORD:-}" ]]; then
      echo "Check the cloud SSH password, or leave it empty and use a key that can log in as ${USER}@${HOST}." >&2
      echo "Note: sshpass + ssh -f is unsupported; this script uses ControlPersist instead." >&2
    else
      echo "No SSH password was provided; configure key-based login for ${USER}@${HOST}." >&2
    fi
    return "$ec"
  fi
}
