# Atolla Modern Conversation Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a switchable conversation-first modern workspace while preserving the current classic administration UI.

**Architecture:** Extend the existing conversations table for multi-thread summaries and keep `managed_agents.conversation_id` as the active pointer. Add a modern React shell that consumes those summaries and reuses the existing managed-agent chat panel in focus mode, while the classic shell remains untouched.

**Tech Stack:** Go, Gin, MySQL, React 19, Vite, vanilla CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-23-modern-conversation-workspace-design.md`

## Global Constraints

- Default UI style remains `classic`; preference key is `atolla_ui_style_v1` with values `classic|modern`.
- Do not add frontend dependencies or migrate the React/Vite stack.
- Preserve current chat, SSE, approvals, attachments, mentions, group chat, deep links and classic UI behavior.
- Creating or activating a conversation for a busy agent returns HTTP 409.
- Use the existing status priority: error, approval, running, completed.

## Review Focus

- A busy agent must keep its active conversation when create/activate is attempted; Task 1 integration test covers the 409 path.
- Empty or missing conversation titles must fall back to the latest user preview and then `新对话`; Task 1 store test covers fallback.
- A corrupted local UI-style value must resolve to classic; Task 2 unit test covers normalization.
- Re-selecting a different conversation for the same agent must reload messages; Task 3 component interface and build verification cover `conversationRefreshKey`.
- Narrow screens must keep the composer usable while the recent sidebar becomes a drawer; Task 4 CSS and production build cover the responsive contract.

---

### Task 1: Managed-agent conversation threads

**Files:**
- Create: `server/internal/store/agent_conversations.go`
- Create: `server/internal/store/agent_conversations_test.go`
- Modify: `server/internal/store/store.go`
- Modify: `server/internal/service/managed_agents.go`
- Modify: `server/internal/handler/managed_agents.go`
- Modify: `server/internal/handler/handler.go`

**Interfaces:**
- Produces `store.AgentConversationSummary`, `ListAgentConversations`, `CreateAndActivateAgentConversation`, `ActivateAgentConversation`, and `UpdateAgentConversation`.
- Produces authenticated routes under `/api/admin/agent-conversations` and `/api/admin/agents/:id/conversations`.

- [ ] Write store tests proving create preserves the previous thread, activation changes only the active pointer, list ordering/title fallback, and foreign-agent activation rejection.
- [ ] Run `GOCACHE=/private/tmp/atolla-go-cache go test ./internal/store -run AgentConversation -count=1` and verify RED because interfaces do not exist.
- [ ] Implement migration fields, store methods, service busy guard and handlers with Chinese comments at the state-transition points.
- [ ] Run the focused store/service/handler tests and verify GREEN.
- [ ] Run `GOCACHE=/private/tmp/atolla-go-cache go test ./internal/store ./internal/service ./internal/handler -count=1`.

### Task 2: Modern workspace pure model

**Files:**
- Create: `web/src/modernWorkspaceModel.js`
- Create: `web/src/modernWorkspaceModel.test.js`

**Interfaces:**
- Produces `normalizeUIStyle`, `groupRecentConversations`, `filterConversationSummaries`, `conversationDisplayTitle`, and `highestAgentState`.
- Consumed by Task 3 and Task 4.

- [ ] Write Node tests for style fallback, title fallback, time grouping, search and state priority.
- [ ] Run `node --test src/modernWorkspaceModel.test.js` and verify RED because the module does not exist.
- [ ] Implement the minimal pure functions.
- [ ] Run the focused Node tests and verify GREEN.

### Task 3: Conversation-first workspace and agent picker

**Files:**
- Create: `web/src/ModernWorkspace.jsx`
- Create: `web/src/modernWorkspaceIcons.jsx`
- Modify: `web/src/ManagedAgents.jsx`

**Interfaces:**
- Consumes Task 1 routes and Task 2 model helpers.
- Produces `ModernWorkspace({ authHeaders, onUnauthorized, onOpenMenu, onUseClassic, ... })`.
- Extends `ManagedAgentsPanel` with `presentation="classic|focus"` and `conversationRefreshKey` without changing classic defaults.

- [ ] Add a failing model-level test for the keyboard picker selection reducer used by `ModernWorkspace`.
- [ ] Run the focused Node test and verify RED.
- [ ] Implement recent list, new-conversation picker, search, pin/archive actions, more menu and focus-mode chat reuse.
- [ ] Run Node tests, `npm run lint`, and `npm run build`.

### Task 4: Dual shell, visual system and responsive behavior

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `web/src/App.css`
- Modify: `web/src/SettingsPanel.jsx` if present, otherwise keep the switch in modern menu and top bar.
- Modify: `web/src/changelog.js`

**Interfaces:**
- Consumes `ModernWorkspace` and `normalizeUIStyle`.
- Produces persisted classic/modern shell selection and modern navigation into existing admin modules.

- [ ] Add failing tests for UI-style persistence helpers and menu grouping where behavior is pure.
- [ ] Run focused Node tests and verify RED.
- [ ] Implement shell selection, modern low-frequency module header, palette, focus/hover/pressed states and responsive drawer.
- [ ] Run all Node tests: `node --test src/*.test.js src/workflow/*.test.js`.
- [ ] Run `npm run lint`, `npm run build`, backend targeted tests and `git diff --check`.

