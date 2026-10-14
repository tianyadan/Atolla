# remote-relay v0.0.2 Mobile Hub / Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship remote-relay v0.0.2: settings+changelog cursor API, instance 4-grid hub, agents grouped by folder with idle/busy, full text chat via `agent.ask`/`stop`/`set_task_plan`, and enriched agent sync.

**Architecture:** Extend Hybrid command queue (phone → relay → Mac long-poll). Mirror agents/tasks/messages stay the phone’s read model; ask is fire-and-forget with polling. Changelog parsed from `CHANGELOG.md` in-process.

**Tech Stack:** Express+SQLite+Vitest (relay), React+Vite+TS (web), Go RemoteBridge (Mac).

**Spec:** `docs/superpowers/specs/2026-10-13-remote-relay-mobile-hub-chat-design.md`

## Global Constraints

- Version **0.0.2** / **v0.0.2** everywhere
- Status UI: only 空闲 / 忙碌中
- No group chat body, no mobile permission UI, no @, no image send
- Commits only if user asks

---

### Task 1: Changelog parse + meta API

**Files:**
- Create: `remote-relay/server/src/changelog.ts`
- Create: `remote-relay/server/src/changelog.test.ts`
- Create: `remote-relay/server/src/routes/meta.ts`
- Modify: `remote-relay/server/src/app.ts`
- Modify: `remote-relay/server/package.json` (version `0.0.2`)
- Modify: `remote-relay/CHANGELOG.md` (add v0.0.2 stub at top when feature lands; parser test uses fixture string)

**Produces:** `parseChangelog(md)`, `pageChangelog(entries, cursor, limit)`, `GET /api/meta/version`, `GET /api/meta/changelog`

- [ ] TDD parse + cursor; wire routes behind site JWT; bump package version

### Task 2: Allow agent.ask/stop/set_task_plan enqueue + site routes

**Files:**
- Modify: `remote-relay/server/src/registry.ts`
- Modify: `remote-relay/server/src/routes/site.ts`
- Modify: `remote-relay/server/src/commands.test.ts`
- Modify: `remote-relay/server/src/mirror.test.ts` (if needed)

**Produces:** `POST .../ask`, `.../stop`, `.../task-plan`; V1_EXECUTABLE includes three actions

- [ ] Tests: ask enqueues; old reserved rejection removed; task-plan body validated

### Task 3: Go RemoteBridge handlers + sync.agents fields

**Files:**
- Modify: `server/internal/remotebridge/registry.go`
- Modify: `server/internal/remotebridge/handlers.go`
- Create or modify: ask/stop/task_plan handlers + tests
- Modify: `handleSyncAgents` to include avatar_url, folder_id, folder_name, task_plan_enabled
- Enhance `handleSyncMessages` to include attachments in payload when present

**Produces:** Mac can execute ask/stop/set_task_plan; richer agent/message snapshots

- [ ] Unit tests for registry + sync payload shape; ask accepted path

### Task 4: Web settings + changelog pages

**Files:**
- Create: `remote-relay/web/src/pages/Settings.tsx`, `Changelog.tsx`
- Create: `remote-relay/web/src/components/SettingsIcon.tsx`
- Modify: `remote-relay/web/src/App.tsx`, `api.ts`, `pages/Instances.tsx`

- [ ] Settings gear on instances; version fetch; infinite scroll changelog

### Task 5: Instance Hub 4-grid

**Files:**
- Create: `remote-relay/web/src/pages/InstanceHub.tsx`
- Create: SVG icon components (Agents, GroupChat)
- Modify: `App.tsx` routes; `Instances.tsx` navigate to hub after unlock

- [ ] 4 cells; group chat “正在开发”; empty slots disabled

### Task 6: Agents list by folder + two-state status

**Files:**
- Modify: `remote-relay/web/src/pages/Agents.tsx`
- Create: `remote-relay/web/src/utils/agentStatus.ts`
- Modify: `api.ts` types for payload fields
- Remove/redirect `AgentDetail.tsx`

- [ ] Group by folder_name; click → chat; avatar default

### Task 7: Chat page (history + ask + task plan + progress)

**Files:**
- Rewrite: `remote-relay/web/src/pages/ChatHistory.tsx` → chat composer UI
- Modify: `api.ts` ask/stop/taskPlan helpers
- Reuse: `Modal.tsx`

- [ ] Header avatar/name/status; progress bar+modal; send/interrupt/stop; poll mirrors

### Task 8: CHANGELOG v0.0.2 + verify

**Files:**
- Modify: `remote-relay/CHANGELOG.md`, README if needed

- [ ] `npm test` in server; `npm run build` in web; Go tests for remotebridge
