# Mobile Agent Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mobile agent list + chat get a settings sheet (editable rules prompt, skills install/uninstall, read-only legacy mounts) via relay Command RPC.

**Architecture:** Extend Mac `remotebridge` actions; relay `enqueueAndWait` + site routes; shared `AgentSettingsSheet` on mobile web. Spec: `docs/superpowers/specs/2026-10-15-mobile-agent-settings-design.md`.

**Tech Stack:** Go remotebridge, Node/TS remote-relay, React TS mobile web.

## Global Constraints

- No engine switch; no name/policy/avatar edits; no legacy claim; no DB/server source config UI.
- No `rm` / unlink commands.
- CHANGELOG bump remote-relay to v0.0.10.

---

### Task 1: Mac remotebridge settings/skills/legacy actions

**Files:**
- Modify: `server/internal/remotebridge/registry.go`
- Create: `server/internal/remotebridge/settings_actions.go`
- Modify: `server/internal/remotebridge/bridge_test.go` (action count)

- [ ] Add 7 actions to `RegisteredActions` + `Handlers`
- [ ] Implement handlers using Store/service (settings get/update, skills list/store/install/uninstall, legacy mounts)
- [ ] Update registry test expected count
- [ ] Run `go test ./internal/remotebridge/...`

### Task 2: Relay enqueueAndWait + registry + routes

**Files:**
- Modify: `remote-relay/server/src/registry.ts`
- Modify: `remote-relay/server/src/commands.ts`
- Modify: `remote-relay/server/src/routes/site.ts`
- Modify: tests as needed

- [ ] Register new actions in `KNOWN_ACTIONS` / `V1_EXECUTABLE`
- [ ] Implement `enqueueAndWait` + notify on result
- [ ] Add site routes under `/instances/:id/agents/:agentId/...`
- [ ] Tests for wait success/timeout + route smoke
- [ ] Run relay server tests

### Task 3: Mobile API + AgentSettingsSheet + entries

**Files:**
- Modify: `remote-relay/web/src/api.ts`
- Create: `remote-relay/web/src/components/AgentSettingsSheet.tsx`
- Modify: `Agents.tsx`, `ChatHistory.tsx`, CSS
- Modify: `CHANGELOG.md` → v0.0.10

- [ ] API helpers wrapping new routes
- [ ] Sheet with 3 tabs
- [ ] Gear on list card + chat header
- [ ] Vitest for any pure helpers if added
- [ ] `npm test` + build web

### Task 4: Verify + changelog

- [ ] Go + relay + web tests pass
- [ ] Conventional commit message for user (do not commit unless asked)
