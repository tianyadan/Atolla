# Task 8 Report — 管理台远程中继 + 部署脚本

## Deploy script review fixes (2026-10-13)

- **install.sh**: Remote `mkdir` / `cd` use `bash -s -- "$REMOTE_DIR"` with quoted paths (no inline single-quoted interpolation). `/etc/atolla-remote-relay.env` is written via `sudo tee` with `$(printf '%s' …)` for `PORT`, `SITE_PASSWORD`, and `RELAY_JWT_SECRET` so shell metacharacters in secrets cannot break the file or inject commands.
- **atolla-remote-relay.service**: `ExecStart` uses `/usr/bin/env npm` so systemd picks `npm` from the service `PATH` instead of a hard-coded `/usr/bin/npm`.
- **RemoteRelayPanel.jsx**: Generated `install.sh` command wraps host, user, remote dir, and site password with `shellSingleQuote()` (bash-safe single-quote escaping).

**Verification:** `npm run build` in `web/` succeeded after JSX change.

**Commit:** `fix(remote-relay): quote deploy secrets and paths safely`
