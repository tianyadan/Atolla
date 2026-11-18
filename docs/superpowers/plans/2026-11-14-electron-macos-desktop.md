# Electron macOS Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an Apple Silicon macOS Electron application that starts Atolla's bundled Go backend and serves the existing React UI locally.

**Architecture:** Electron manages a loopback-only Go child process. In production the Go backend serves `web/dist`, preserving the existing `/api` and SSE origin; in development Electron loads Vite. Runtime state belongs in the macOS Application Support directory, never in the application bundle.

**Tech Stack:** Electron, electron-builder, Node.js ESM, React 19/Vite 8, Go 1.26, Gin, SQLite.

**Spec:** `docs/superpowers/specs/2026-11-14-electron-macos-design.md`

## Global Constraints

- Target only `darwin/arm64`; do not emit Intel, Windows or Linux artifacts.
- Keep the renderer sandboxed: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Bind the bundled backend only to `127.0.0.1` on a dynamically allocated port.
- Preserve existing `/api` and SSE semantics; no renderer-side API URL rewrite.
- Store mutable files below `~/Library/Application Support/Atolla/`.
- Do not package `.env`, source databases, logs, or iOS build outputs.

## Review Focus

- A stale or unavailable port must result in a visible startup error and no hanging window; cover in desktop runtime tests.
- Backend startup failure must terminate the child process and leave no listener; cover in lifecycle tests.
- Packaged resource paths must differ correctly from development source paths; cover with pure path-resolution tests.
- SPA deep links must return `index.html`, while `/api` and `/health` retain Go handlers; cover with Go HTTP tests.
- Existing App Support data must survive a second launch unchanged; cover directory-initialization tests.

### Task 1: Serve the production SPA from the Go backend

**Files:**
- Modify: `server/config/config.go`
- Modify: `server/main.go`
- Create: `server/main_test.go`

**Interfaces:**
- Consumes: `AVATAR_WEB_DIR` as an optional absolute directory containing Vite output.
- Produces: `config.Config.WebDir string` and an HTTP handler that serves SPA assets only when `WebDir` is configured.

- [ ] **Step 1: Write failing Go tests for configured static assets, SPA fallback, and `/api`/`/health` precedence**

Use a temporary web directory containing `index.html` and one asset. Assert an unknown non-API route returns `index.html`, an existing asset is returned verbatim, and API/health routes do not fall through to the SPA.

- [ ] **Step 2: Run the focused Go tests to verify failure**

Run: `cd server && go test ./... -run 'Test.*Web'`

Expected: FAIL because `WebDir` and production SPA routing do not exist.

- [ ] **Step 3: Add optional `WebDir` configuration and static SPA routing**

Validate that the directory exists before enabling the fallback. Register API routes first; only non-API GET/HEAD requests may resolve assets or return `index.html`.

- [ ] **Step 4: Run focused and full backend tests**

Run: `cd server && go test ./...`

Expected: PASS.

- [ ] **Step 5: Commit the backend static-serving change**

```bash
git add server/config/config.go server/main.go server/main_test.go
git commit -m "feat: serve bundled web assets from backend"
```

### Task 2: Add a secure Electron runtime layer

**Files:**
- Create: `desktop/package.json`
- Create: `desktop/main.mjs`
- Create: `desktop/runtime.mjs`
- Create: `desktop/preload.mjs`
- Create: `desktop/test/runtime.test.mjs`

**Interfaces:**
- Produces: `resolveRuntimePaths(options)`, `ensureRuntimeDirectories(paths)`, `allocateLoopbackPort()`, and `startBackend(options)` from `desktop/runtime.mjs`.
- Consumes: packaged resources at `Resources/bin/atolla-server` and `Resources/web/`, plus Electron `app.getPath('userData')`.

- [ ] **Step 1: Write Node tests for packaged/development path resolution and idempotent App Support directory creation**

Assert packaged mode resolves binaries below `resourcesPath`, development mode resolves repository paths, and existing data files are not overwritten.

- [ ] **Step 2: Run the runtime tests to verify failure**

Run: `cd desktop && node --test test/runtime.test.mjs`

Expected: FAIL because the runtime module is absent.

- [ ] **Step 3: Implement runtime helpers and child-process lifecycle management**

`startBackend(options)` must spawn only the expected backend executable, pass a white-listed environment, wait for `/health`, and terminate the owned child on timeout or failure. Use a dynamically allocated loopback port and return `{ baseUrl, child, stop }`.

- [ ] **Step 4: Implement the Electron main process and minimal preload layer**

Create the browser window only after `startBackend` resolves. Use sandboxed web preferences. Load Vite in development and the backend origin in production. On `before-quit` and startup failure call `stop()` exactly once.

- [ ] **Step 5: Run Node tests and a manual Electron development smoke test**

Run: `cd desktop && node --test test/runtime.test.mjs`

Expected: PASS.

Run: `npm run desktop:dev`

Expected: Electron opens after `/health`; login page loads and no renderer console shows a `file://` API failure.

- [ ] **Step 6: Commit the desktop runtime layer**

```bash
git add desktop
git commit -m "feat: add secure Electron desktop runtime"
```

### Task 3: Add repeatable arm64 packaging

**Files:**
- Create: `desktop/electron-builder.yml`
- Create: `desktop/scripts/build-backend.mjs`
- Create: `desktop/scripts/prepare-resources.mjs`
- Modify: `desktop/package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `web/package.json` build command and `server/go.mod`.
- Produces: `npm run desktop:package`, an arm64 `.dmg`, and a `.app` whose resources contain `bin/atolla-server` and `web/`.

- [ ] **Step 1: Add a packaging assertion script before implementation**

The script must fail unless the backend is a Mach-O arm64 executable and the staged web directory contains `index.html`.

- [ ] **Step 2: Run the assertion script to verify failure before staged resources exist**

Run: `cd desktop && npm run verify:resources`

Expected: FAIL with a missing-resource diagnostic.

- [ ] **Step 3: Implement ordered frontend build, `darwin/arm64` Go compilation, staging, and electron-builder configuration**

Package only the desktop runtime and staged resources. Exclude source trees, `.env`, SQLite databases, logs, `node_modules` outside desktop packaging inputs, and `remote-relay/web/ios/build-device/`.

- [ ] **Step 4: Build and verify the deliverable**

Run: `npm run desktop:package`

Expected: an arm64 DMG in the configured release directory.

Run: `file <generated-app>/Contents/Resources/bin/atolla-server`

Expected: `Mach-O 64-bit executable arm64`.

- [ ] **Step 5: Install/run the generated app and verify lifecycle behavior**

Open the generated app, complete login or load the setup route, start one SSE conversation, quit the app, then confirm the app-owned port no longer listens.

- [ ] **Step 6: Commit packaging support**

```bash
git add desktop .gitignore
git commit -m "build: package Atolla Electron app for macOS arm64"
```

### Task 4: Document local desktop development and release limits

**Files:**
- Create: `docs/electron-macos.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: final `desktop:dev`, `desktop:package`, and release output paths.
- Produces: a documented local development flow and explicit unsigned-build limitations.

- [ ] **Step 1: Document prerequisites and commands**

Cover Node.js, Go, Apple Silicon, development launch, DMG packaging, App Support data locations, log locations, and how to recover from a failed startup.

- [ ] **Step 2: Document security and distribution boundaries**

State that the first release is unsigned and not notarized, so external distribution requires a separate signing/notarization task.

- [ ] **Step 3: Verify all documented commands from a clean local dependency state**

Run the documented development and package commands once; correct documentation that does not match actual output.

- [ ] **Step 4: Commit user documentation**

```bash
git add README.md docs/electron-macos.md
git commit -m "docs: add Electron macOS development guide"
```

## Self-Review

- Spec coverage: Tasks 1-3 implement startup, local serving, persistence, packaging, arm64 scope, security, and lifecycle; Task 4 records user-facing limitations.
- Step scan: every task begins with a failure condition and ends with a command-based verification plus an isolated commit.
- Type consistency: Task 2 defines the runtime exports consumed by the main process; Task 3 only stages the packaged resource paths defined by Task 2.
- Review focus: port, process, path, SPA-routing, and persistent-data failure modes are assigned to Tasks 1-3.
- Proportion: the plan specifies integration points and checks without pre-writing implementation bodies.
