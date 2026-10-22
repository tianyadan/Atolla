# Mobile Jelly Avatar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Mobile mirrors PC jelly avatars; settings can change `jelly_color`.

**Architecture:** Merge backend jelly_color branch → extend `agent.settings.update` → port PC jelly UI into `remote-relay/web` → replace `<img>` avatars → deploy relay then restart Atolla.

**Tech Stack:** Go remotebridge, React/TS remote-relay web, existing PC jelly sprites.

## File map

- Backend (from jelly-color branch + small settings patch): store / migrate / handlers / settings_actions / sync payload
- Mobile: `remote-relay/web/src/jelly/*` or flat jelly files, sprites under `public/jelly-sprites/`, Agents / ChatHistory / AgentSettingsSheet / agentStatus utils

### Task 1: Merge jelly_color backend

- Merge `origin/cursor/jelly-color-backend-d18a` into `feat/jelly-avatar`
- Resolve conflicts carefully; run Go tests for store jelly_color

### Task 2: Settings update accepts jelly_color

- Extend `handleAgentSettingsUpdate` optional `jelly_color`
- Return in `settingsPublic`
- Relay API types if needed

### Task 3: Port jelly UI to remote-relay

- Copy sprites + port JellyAvatar / ColorPicker / jellyColor / jellySprite (+ CSS)
- Replace avatar imgs; wire settings picker

### Task 4: Verify + deploy

- Go + relay tests / web build
- Cloud relay then local Atolla restart
