# Design: Manual SQLite path (Web + Electron)

**Status:** Draft for review
**Decision locked:** Retarget DSN + **optional migrate/copy** when the target is empty/new (user chose option 2).

## 1. Background

Web (repo `data/atolla.db`) and Electron (Application Support DB) use different default SQLite files, so data does not interoperate. Settings already switch SQLite ↔ MySQL via `AVATAR_DB_DRIVER` / `AVATAR_DB_DSN`, but:

- UI only **displays** `sqlite_path` (and status currently uses the **default** path helper, not the live DSN).
- Users cannot pick a custom `.db` file.
- Electron [`desktop/runtime.mjs`](../../../desktop/runtime.mjs) **forces** `AVATAR_DB_DSN` to the packaged default on every launch, which would override a saved custom path unless fixed.

## 2. Goals

1. In **Settings → Database**, while on SQLite, manually set the SQLite file path (Web + Electron).
2. Persist via existing `.env` under runtime/repo root (`AVATAR_DB_DRIVER=sqlite`, `AVATAR_DB_DSN=<abs path>`).
3. Optional **copy current DB → new path** when migrate is requested and the target is empty/new.
4. Restart backend after a successful path change (same pattern as driver switch).
5. Electron: native file picker (open existing / save new) via IPC; Web: path text input (+ optional browse if a native picker exists on the host).

## 3. Non-goals (this iteration)

- Continuous two-process sync / multi-writer coordination beyond a soft warning.
- Import/merge of two non-empty databases.
- Changing MySQL DSN UI (unchanged).
- Cloud/remote DB files.

## 4. Behavior

### 4.1 Status API

`GET /api/admin/db/status` must report:

- `sqlite_path` = **effective** SQLite path (`Cfg.DBDSN` when driver is sqlite; else default for display helpers).
- `sqlite_default_path` = platform default (`dbconfig.SQLiteDSN(root)`).
- `sqlite_writable` = parent dir writable.
- Existing fields unchanged (`has_data`, migrate progress, etc.).

### 4.2 Set path API

`POST /api/admin/db/sqlite-path`

```json
{ "path": "/abs/path/to/atolla.db", "migrate": false }
```

Rules:

1. Normalize to absolute, cleaned path; reject empty / relative / non-`.db` (case-insensitive) / suspicious names.
2. Ensure parent directory exists (mkdir) and is writable.
3. If file missing: create empty SQLite (open via store bootstrap) **or** leave create to first open after restart — prefer mkdir + allow store migration create on boot.
4. If `migrate: true`:
   - Require current driver is sqlite and current store `HasData`.
   - Target must be **missing or empty DB** (no user data). If target already has data → `400` with clear error (no silent overwrite).
   - Copy current → target via existing `dbmigrate.CopyAll` (sqlite→sqlite).
5. If `migrate: false` and target exists with data → retarget only (use as-is).
6. Write `.env` with `WriteSQLitePath(root, path)` (keep driver=sqlite, set DSN, chosen=1).
7. Trigger restart like `AdminSwitchDB` (`pending` / `manual`).

### 4.3 UX ([`web/src/DbSettings.jsx`](../../../web/src/DbSettings.jsx))

When current driver is SQLite:

- Show **current path** (editable text field).
- Buttons: **Browse…** (Electron IPC / host picker), **Use default**, **Apply**.
- On Apply: if path ≠ current and current `has_data` and target empty/new → confirm modal with checkbox “Copy current data into the new file” (`migrate`).
- If target already has data → confirm “Switch to this database file (no copy)” only.
- Soft warning: do not run Web and Electron backends against the same file concurrently if both write.

### 4.4 Electron

- Extend [`desktop/preload.mjs`](../../../desktop/preload.mjs) + [`desktop/main.mjs`](../../../desktop/main.mjs): `dialog.showOpenDialog` / `showSaveDialog` for `.db`.
- Change [`desktop/runtime.mjs`](../../../desktop/runtime.mjs): do **not** overwrite `AVATAR_DB_DSN` when `.env` under `AVATAR_RUNTIME_ROOT` already defines it; only set default when unset.

## 5. Files to touch

| Area | Files |
|------|--------|
| Config | `server/internal/dbconfig/env.go` — `WriteSQLitePath`, status helpers |
| Service | `server/internal/service/db_switch.go` — status fix, `SetSQLitePath` |
| Handler | `server/internal/handler/db_settings.go` + route in `handler.go` |
| Web | `web/src/DbSettings.jsx`, `web/src/i18n/messages.js`, light CSS |
| Desktop | `desktop/runtime.mjs`, `desktop/main.mjs`, `desktop/preload.mjs` |
| Tests | dbconfig + db_switch path validation / migrate-into-empty |

## 6. Risks

- Two writers on one SQLite file → warn in UI; do not claim live multi-instance sync.
- Electron env override → must fix or custom path never sticks.
- Status currently lies about path → fix before shipping UI.

## 7. Approval

User chose **option 2** (retarget + optional migrate). Pending review of this spec before implementation.
