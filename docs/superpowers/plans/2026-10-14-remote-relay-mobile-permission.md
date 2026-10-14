# Remote Relay Mobile Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mobile chat can approve pending commands and sync PC「命令全部审批通过」/「自动审核」 via relay (no direct Mac API).

**Architecture:** Extend hybrid command actions (`agent.set_auto_*`, `permission.decide`); Mac pushes pending permissions into `permissions_mirror`; phone polls mirror and shows PermCard + settings Modal.

**Tech Stack:** Go remotebridge, Express/SQLite remote-relay, React TSX web.

## Global Constraints

- remote-relay version **v0.0.3** (package.json + CHANGELOG + `/api/meta/version`)
- No direct phone → Mac `/permissions/*`
- Hard Deny still blocked on Mac Gateway
- When `auto_approve_all` on, disable auto-review toggle in UI
- Spec: `docs/superpowers/specs/2026-10-14-remote-relay-mobile-permission-design.md`

---

## File map

| Area | Files |
|------|--------|
| Relay DB/mirror | `remote-relay/server/src/db.ts`, `mirror.ts`, new permissions helpers or extend mirror |
| Device/site routes | `device.ts`, `site.ts`, `registry.ts`, `commands.ts` |
| Tests | `mirror.test.ts`, `commands.test.ts`, new permissions tests |
| Go bridge | `registry.go`, `handlers.go`, `agent_actions.go`, `runtime.go`, new `permissions.go`, `client.go`, `bridge.go` |
| Go tests | `agent_actions_test.go`, `bridge_test.go` |
| Web | `api.ts`, `ChatHistory.tsx`, `agentStatus.ts`, `index.css`, maybe `PermCard` component |
| Meta | `CHANGELOG.md`, `server/package.json`, changelog parser tests if any |

---

### Task 1: Relay permissions mirror + site/device APIs

- [x] TDD: failing tests for upsert/delete + GET pending by agent
- [x] Schema `permissions_mirror` + mirror helpers
- [x] Device POST snapshot / resolved; site GET pending
- [x] Tests green

### Task 2: Relay enqueue actions + site POSTs

- [x] TDD: enqueue `agent.set_auto_review`, `agent.set_auto_approve_all`, `permission.decide`
- [x] Register in `V1_EXECUTABLE` + registry
- [x] Site routes under agents
- [x] Tests green

### Task 3: Go agents payload + set_auto / decide handlers

- [x] TDD: handlers for set_auto_* and permission.decide; agents snapshot fields
- [x] Extend AgentRuntime / Perms on ExecContext
- [x] Wire from service when constructing bridge
- [x] Tests green

### Task 4: Go push pending permissions on connect + Hub subscribe

- [x] Client PostPermissionsSnapshot / PostPermissionsResolved
- [x] Bridge subscribe: request → Pending refresh upsert; resolved → delete
- [x] Push full Pending(0) on connect
- [x] Tests or smoke as feasible

### Task 5: Mobile web UI

- [x] API helpers + agentStatus readers for auto flags
- [x] ChatHistory: 命令审批设置 Modal
- [x] Pending poll + approval Modal (拒绝/本次允许/本次会话允许)
- [x] CSS; `npm run build`

### Task 6: Version + verify

- [x] Bump to 0.0.3 + CHANGELOG
- [x] Run relay tests + go remotebridge tests + web build
- [x] Conventional commit message line for user (no commit unless asked)
