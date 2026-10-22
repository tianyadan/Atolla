# iOS Live Activity Multi-Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Extend Atolla iOS Live Activity from running-only display to prioritized error, approval, running, and completed states with latest-per-agent unread semantics and deep-link navigation.

**Architecture:** Persist one latest terminal-event snapshot per managed agent on Mac, mirror it through the existing agent payload, and aggregate it with relay permission rows in the Capacitor App. Drive one ActivityKit activity with the highest-priority category and route taps through validated atolla deep links.

**Tech Stack:** Go, MySQL 8, TypeScript, Express, better-sqlite3, React 19, Capacitor 7, SwiftUI, WidgetKit, ActivityKit, Vitest, Go test, Xcode.

**Spec:** docs/superpowers/specs/2026-10-23-ios-live-activity-status-design.md

## Global Constraints

- Display priority is exactly error > approval > running > completed.
- Keep one Live Activity; do not create one activity per event or agent.
- One agent retains only its latest unread completed/error snapshot; approvals remain one item per request_id.
- Opening a completed/error agent chat marks that terminal event read; opening an approval does not resolve it.
- Native details contain at most 5 items; expanded UI renders at most 3 rows plus a remainder count.
- Support iOS 16.2+; use Symbol Effect only behind an iOS 17 availability check.
- Do not add APNs, push tokens, unrelated background modes, or new production dependencies.
- Suspended or terminated App state is not guaranteed to update until foreground refresh.
- Preserve unrelated worktree changes and stage only files owned by the task.

## Review Focus

- Legacy or malformed agent payloads must not invent terminal events; Task 4 pins running-only fallback.
- Expired permissions and permissions whose agent no longer exists must not reach the island; Tasks 3 and 4 pin both filters.
- More than five same-priority events must preserve total count while sending five details; Task 4 pins this.
- Encoded IDs, invalid schemes, and locked instances must not lose or misroute targets; Task 8 pins this.
- An agent that starts a new run while an older error is unread must still surface the unread error first; Task 4 pins this mixed-state case.

---

### Task 1: Persist the latest terminal-event snapshot

**Files:**
- Create: db/migrate_v0.5.11.sql
- Create: server/internal/store/task_unread_test.go
- Modify: db/schema.sql
- Modify: server/internal/store/managed_agents.go
- Modify: server/internal/store/store.go

**Interfaces:**
- Produces ManagedAgent fields: TaskUnreadKind string, TaskUnreadAt *time.Time, TaskUnreadDurationMs int, TaskUnreadSummary string.
- SetManagedAgentStatus atomically snapshots busy-to-idle or busy-to-error.
- ClearManagedAgentTaskUnread clears compatibility and snapshot fields.

- [ ] **Step 1: Write failing MySQL-backed tests**

Add:
- TestManagedAgentTerminalUnreadSnapshot: running to idle sets completed, timestamp, and duration.
- TestManagedAgentErrorUnreadSnapshot: running to error snapshots the exact error.
- TestManagedAgentUnreadLatestWins: a second terminal event overwrites the first.
- TestManagedAgentStartDoesNotClearUnread: a new run preserves the prior unread.
- TestClearManagedAgentTaskUnreadClearsSnapshot: all snapshot fields become empty.

Use openTestStore, createTestAgent, and t.Cleanup.

- [ ] **Step 2: Verify failure**

Run:

    cd server
    go test ./internal/store -run 'TestManagedAgent(Terminal|Error|Unread|Start)|TestClearManagedAgentTaskUnread' -count=1

Expected: FAIL because snapshot fields/schema do not exist; SKIP is acceptable only if local MySQL is unavailable.

- [ ] **Step 3: Add schema and idempotent migration**

Add the existing task_unread compatibility field plus the four spec fields to schema.sql; add the four new fields to migrate_v0.5.11.sql. Extend EnsureTaskUnreadSchema to add each missing column independently and backfill task_unread=1 rows: current error becomes error, otherwise completed; copy updated_at, last_run_ms, and last_error.

- [ ] **Step 4: Extend model, scan, transition, and clear SQL**

Update ManagedAgent, scanManagedAgent, and managedSelectCols. Preserve old snapshots on a new running transition. Overwrite only when an origin in running, busy, waiting, 插话中, or compressing moves to idle/error.

- [ ] **Step 5: Verify store**

Run: cd server && go test ./internal/store -count=1

Expected: PASS, or only MySQL-dependent tests SKIP; test-created agents are cleaned up.

- [ ] **Step 6: Commit**

    git add db/schema.sql db/migrate_v0.5.11.sql server/internal/store/managed_agents.go server/internal/store/store.go server/internal/store/task_unread_test.go
    git commit -m "feat: persist agent terminal unread snapshots"

### Task 2: Mirror terminal snapshots and clear them on chat entry

**Files:**
- Create: server/internal/remotebridge/agent_snapshot.go
- Create: server/internal/remotebridge/agent_snapshot_test.go
- Modify: server/internal/remotebridge/handlers.go
- Modify: server/internal/remotebridge/viewer_test.go

**Interfaces:**
- Consumes Task 1 snapshot fields.
- Produces buildAgentMirrorPayload(a store.ManagedAgent, folderName string, usage agentMirrorUsage) map[string]any.
- Adds payload keys task_unread_kind, task_unread_at as Unix seconds, task_unread_duration_ms, and task_unread_summary.

- [ ] **Step 1: Write failing payload tests**

Assert completed/error snapshots serialize all fields, the timestamp is Unix seconds, and blank snapshots do not invent details. Extend viewer coverage with a test store when MySQL is available and assert handleViewerSet clears the snapshot.

- [ ] **Step 2: Verify failure**

Run: cd server && go test ./internal/remotebridge -run 'TestBuildAgentMirrorPayload|TestHandleViewerSet' -count=1

Expected: FAIL because the payload builder and keys do not exist.

- [ ] **Step 3: Extract and wire the payload builder**

Move only payload composition to agent_snapshot.go. Keep database reads and posting in handlers.go. Preserve all existing avatar, color, folder, policy, context, and run-start keys.

- [ ] **Step 4: Verify bridge**

Run: cd server && go test ./internal/remotebridge -count=1

Expected: PASS.

- [ ] **Step 5: Commit**

    git add server/internal/remotebridge/agent_snapshot.go server/internal/remotebridge/agent_snapshot_test.go server/internal/remotebridge/handlers.go server/internal/remotebridge/viewer_test.go
    git commit -m "feat: mirror agent terminal events"

### Task 3: Add instance-wide pending approval reads

**Files:**
- Modify: remote-relay/server/src/mirror.ts
- Modify: remote-relay/server/src/routes/site.ts
- Modify: remote-relay/server/src/mirror.test.ts

**Interfaces:**
- Produces listInstancePermissionsMirror(db, instanceId, nowMs?) with PublicMirrorPermission items.
- Produces GET /api/instances/:id/permissions/pending, guarded by site auth and instance unlock.

- [ ] **Step 1: Write the failing relay integration test**

Insert two agents' permissions plus an expired row. Assert the endpoint returns both live rows newest-first, excludes the expired row, returns 403 without unlock, and 404 for an unknown instance.

- [ ] **Step 2: Verify failure**

Run: cd remote-relay/server && npm test -- src/mirror.test.ts

Expected: FAIL with 404 for the missing route.

- [ ] **Step 3: Implement reader and route**

Query by instance_id, apply the same parseable-deadline rule as the per-agent reader, and order by synced_at DESC, request_id ASC. Preserve the existing per-agent endpoint.

- [ ] **Step 4: Verify relay**

Run: cd remote-relay/server && npm test && npm run build

Expected: PASS.

- [ ] **Step 5: Commit**

    git add remote-relay/server/src/mirror.ts remote-relay/server/src/routes/site.ts remote-relay/server/src/mirror.test.ts
    git commit -m "feat: list instance pending approvals"

### Task 4: Build and test the App event reducer

**Files:**
- Create: remote-relay/web/src/islandEvents.ts
- Create: remote-relay/web/src/islandEvents.test.ts
- Modify: remote-relay/web/src/api.ts

**Interfaces:**
- Produces IslandEvent, IslandEventKind, and IslandPresentation.
- Produces buildIslandEvents(instanceId, agents, permissions, nowMs?).
- Produces selectIslandPresentation(events, limit?) returning activeKind, full count, and limited items.
- Produces islandEventDeepLink(event).
- Produces fetchPendingInstancePermissions(instanceId).

- [ ] **Step 1: Write reducer tests**

Cover exact priority, one latest terminal snapshot per agent, an older unread error outranking the same agent's new running state, approvals by request_id, five-detail limit with true count, malformed legacy terminal data with running fallback, orphan approval filtering, and percent-encoded deep links.

- [ ] **Step 2: Verify failure**

Run: cd remote-relay/web && npm test -- src/islandEvents.test.ts

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement reducer and API wrapper**

Use task_unread_kind as the only terminal discriminator. Use snapshot time/duration/summary, run_started_at, folder_name or 未分组, and permission created_at or synced_at. Sort newest first and apply the exact priority table.

- [ ] **Step 4: Verify Web types/tests**

Run: cd remote-relay/web && npm test && npm run build

Expected: PASS.

- [ ] **Step 5: Commit**

    git add remote-relay/web/src/islandEvents.ts remote-relay/web/src/islandEvents.test.ts remote-relay/web/src/api.ts
    git commit -m "feat: aggregate live activity events"

### Task 5: Extend the native ActivityKit state and bridge

**Files:**
- Modify: remote-relay/web/ios/App/App/AtollaBusyAttributes.swift
- Modify: remote-relay/web/ios/App/App/AtollaIslandPlugin.swift
- Modify: remote-relay/web/src/islandLiveActivity.ts

**Interfaces:**
- Consumes Task 4 IslandPresentation.
- Produces IslandItemSlice and ContentState(activeKind, count, items, animPhase, updatedAt).
- Produces Capacitor syncState and TypeScript syncIslandPresentation.
- Preserves syncIslandOptimisticAgent for chat sends.

- [ ] **Step 1: Change the TypeScript plugin contract**

Define the native item shape and syncState request; retain isAvailable and endAll.

Run: cd remote-relay/web && npm run build

Expected: PASS at TypeScript level.

- [ ] **Step 2: Extend Swift content state and parser**

Keep the AtollaBusyAttributes name. Parse at most five items, clamp text lengths, validate activeKind, store deep links as strings, and stop the timer unless activeKind is running.

- [ ] **Step 3: Replace old-schema activities**

Add a schema-version UserDefaults key and needsActivityReplacement(storedSchemaVersion: Int?) -> Bool with nil/old => true and current => false. End old activities and clear the stored activity ID before requesting the new schema.

- [ ] **Step 4: Build the simulator App**

Run:

    cd remote-relay/web/ios/App
    xcodebuild -workspace App.xcworkspace -scheme App -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build

Expected: BUILD SUCCEEDED.

- [ ] **Step 5: Commit**

    git add remote-relay/web/src/islandLiveActivity.ts remote-relay/web/ios/App/App/AtollaBusyAttributes.swift remote-relay/web/ios/App/App/AtollaIslandPlugin.swift
    git commit -m "feat: support live activity event states"

### Task 6: Render the four Live Activity states

**Files:**
- Modify: remote-relay/web/ios/App/AtollaIslandWidget/AtollaBusyLiveActivity.swift

**Interfaces:**
- Consumes Task 5 ContentState and IslandItemSlice.
- Produces compact, minimal, expanded, and lock-screen views for all four states.

- [ ] **Step 1: Add focused SwiftUI components**

Add private IslandStatusIcon, IslandEventRow, IslandExpandedList, and time-format helpers. Use shallow-red xmark, pale-yellow exclamation, green checkmark, and existing jelly running view. Render three rows plus 还有 N 项.

- [ ] **Step 2: Bind links and missing-value fallbacks**

Use the first item as activity widgetURL and row-level Link where supported. Display — for missing time/duration and never synthesize values.

- [ ] **Step 3: Guard effects by OS version**

Use Symbol Effect only under iOS 17 availability. Keep iOS 16.2 static and jelly animation running-only.

- [ ] **Step 4: Build widget and App**

Run:

    cd remote-relay/web/ios/App
    xcodebuild -workspace App.xcworkspace -scheme AtollaIslandWidget -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
    xcodebuild -workspace App.xcworkspace -scheme App -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build

Expected: both BUILD SUCCEEDED.

- [ ] **Step 5: Commit**

    git add remote-relay/web/ios/App/AtollaIslandWidget/AtollaBusyLiveActivity.swift
    git commit -m "feat: render prioritized island statuses"

### Task 7: Drive the island from agents plus approvals

**Files:**
- Modify: remote-relay/web/src/components/IslandBusySyncHost.tsx
- Modify: remote-relay/web/src/islandLiveActivity.ts
- Modify: remote-relay/web/src/pages/ChatHistory.tsx

**Interfaces:**
- Consumes Tasks 3-5 API, reducer, and native sync.
- Produces one 3-second poller and immediate foreground reconciliation.

- [ ] **Step 1: Replace the running-only tick**

Fetch agents and permissions with Promise.all, build/select presentation, and sync it. On either network failure keep the last native state and retry; never publish an empty state from an error.

- [ ] **Step 2: Preserve optimistic running**

Make syncIslandOptimisticAgent construct a one-item running presentation through the same native mapper.

- [ ] **Step 3: Reconcile after actions**

Export invalidateIslandSync. Trigger it after viewer presence marks a terminal item read and after approval success so the host refreshes immediately.

- [ ] **Step 4: Verify Web**

Run: cd remote-relay/web && npm test && npm run lint && npm run build

Expected: PASS.

- [ ] **Step 5: Commit**

    git add remote-relay/web/src/components/IslandBusySyncHost.tsx remote-relay/web/src/islandLiveActivity.ts remote-relay/web/src/pages/ChatHistory.tsx
    git commit -m "feat: sync prioritized island activity"

### Task 8: Implement deep-link navigation and approval targeting

**Files:**
- Create: remote-relay/web/src/utils/deepLink.ts
- Create: remote-relay/web/src/utils/deepLink.test.ts
- Create: remote-relay/web/src/components/NativeDeepLinkHost.tsx
- Modify: remote-relay/web/src/App.tsx
- Modify: remote-relay/web/src/pages/Login.tsx
- Modify: remote-relay/web/src/pages/Instances.tsx
- Modify: remote-relay/web/src/pages/ChatHistory.tsx

**Interfaces:**
- Produces parseAtollaDeepLink(url), deepLinkTargetPath(target), and pending-target storage helpers.
- Produces NativeDeepLinkHost inside BrowserRouter and outside authenticated routes.

- [ ] **Step 1: Write deep-link tests**

Cover agent/approval URLs, percent-encoded IDs, unknown scheme/path, missing segments, storage round-trip, and route generation. Approval routes must include approval_request_id; invalid input returns null without throwing.

- [ ] **Step 2: Verify failure**

Run: cd remote-relay/web && npm test -- src/utils/deepLink.test.ts

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement parser, storage, and listener**

Listen to Capacitor App appUrlOpen. Navigate directly when site and instance tokens exist; otherwise save the target and navigate to login or /instances?unlock=<instanceId>.

- [ ] **Step 4: Resume after login and unlock**

After login, route to pending instance unlock. InstancesPage auto-opens that password modal after list load; if already unlocked, route directly. Clear the target only after final navigation. If the instance is absent, keep the target and show a non-destructive error.

- [ ] **Step 5: Target approval in chat**

Read approval_request_id. Once permissions load, move that request to the front so the existing modal opens it. If absent/expired, keep the chat open and show 该审批已处理或已过期.

- [ ] **Step 6: Verify App**

Run: cd remote-relay/web && npm test && npm run lint && npm run build

Expected: PASS.

- [ ] **Step 7: Commit**

    git add remote-relay/web/src/utils/deepLink.ts remote-relay/web/src/utils/deepLink.test.ts remote-relay/web/src/components/NativeDeepLinkHost.tsx remote-relay/web/src/App.tsx remote-relay/web/src/pages/Login.tsx remote-relay/web/src/pages/Instances.tsx remote-relay/web/src/pages/ChatHistory.tsx
    git commit -m "feat: open island events with deep links"

### Task 9: Full verification and release notes

**Files:**
- Modify: remote-relay/CHANGELOG.md

**Interfaces:**
- Consumes all prior tasks.
- Produces one verified vertical slice and documents the no-certificate limit.

- [ ] **Step 1: Add release notes**

Document all four statuses, exact priority, latest-per-agent unread behavior, approval deep links, and suspended/terminated limitation. Do not claim APNs support.

- [ ] **Step 2: Verify Go**

Run:

    cd server
    go test ./internal/store ./internal/remotebridge ./internal/handler -count=1

Expected: PASS; report MySQL-backed SKIP explicitly.

- [ ] **Step 3: Verify Relay**

Run:

    cd remote-relay/server
    npm test
    npm run build

Expected: PASS.

- [ ] **Step 4: Verify App**

Run:

    cd remote-relay/web
    npm test
    npm run lint
    npm run build
    npm run cap:sync

Expected: PASS; cap sync updates generated iOS assets without deleting user files.

- [ ] **Step 5: Verify native compile**

Run:

    cd remote-relay/web/ios/App
    xcodebuild -workspace App.xcworkspace -scheme App -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build

Expected: BUILD SUCCEEDED.

- [ ] **Step 6: Perform device acceptance**

On a Dynamic Island iPhone, verify mixed priority, one-by-one read removal, same-agent overwrite, approval resolution, locked deep links, foreground correction after suspension, and activity ending when empty. Do not report this passed from simulator output alone.

- [ ] **Step 7: Check diff and commit release notes**

Run: git diff --check

Expected: no output.

    git add remote-relay/CHANGELOG.md
    git commit -m "docs: note live activity status updates"
