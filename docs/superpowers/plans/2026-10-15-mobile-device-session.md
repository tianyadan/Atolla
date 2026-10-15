# Mobile Device Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist instance unlock on remote-relay server (7d, localStorage + heartbeat) and show/kick mobile devices in Atolla Remote Relay panel.

**Architecture:** SQLite `instance_device_sessions`; unlock JWT carries `sid`; verify checks DB; Mac device API lists/kicks; Atolla admin proxies via RelayClient.

**Tech Stack:** remote-relay (Express/SQLite/vitest), Atolla Go bridge, React (relay web + RemoteRelayPanel).

## Global Constraints

- Instance unlock only (site gate unchanged)
- Online = last_seen within 90s; heartbeat ~30s
- Session TTL 7 days with sliding renew when &lt;3d left
- Old JWT without sid rejected

---

### Task 1: Relay session store + unlock verify
- [x] Schema + `deviceSession.ts` (create/verify/heartbeat/revoke/list)
- [x] Tests in `unlock.test.ts`
- [x] Wire unlock JWT with sid; createRequireInstanceUnlock checks DB

### Task 2: Site + device HTTP routes
- [x] heartbeat / sessions/me; device GET/DELETE mobile-sessions
- [x] Password revoke bulk-revokes sessions

### Task 3: Relay mobile web
- [x] localStorage unlock; unlock with device_label; heartbeat hook; logout me

### Task 4: Atolla bridge + admin API + UI
- [x] RelayClient list/kick; admin handlers; RemoteRelayPanel device cards

### Task 5: Changelog + verify tests
- [x] Done (relay 44, Go packages ok)
