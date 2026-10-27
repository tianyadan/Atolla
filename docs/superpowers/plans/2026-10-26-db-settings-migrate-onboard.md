# DB Settings / Onboard / Migrate Implementation Plan

> **For agentic workers:** Implement task-by-task. Spec: `docs/superpowers/specs/2026-10-26-db-settings-migrate-onboard-design.md`

**Goal:** 引导选库 + 设置页二选一 + SQLite↔MySQL 一键迁库 + 写 `.env` 并尽力重启。

**Architecture:** `internal/dbconfig` 读写 `.env`；`internal/dbmigrate` 表级拷贝；handler 暴露 setup/admin API；前端扩展 Onboarding + `DbSettings`。

**Tech Stack:** Go/Gin, React, existing store dual-driver, docker compose MySQL.

## Global Constraints

- MySQL = 本机 Docker 默认 DSN；无自定义远程
- 迁库清空目标；失败不写 `.env`
- 重启失败展示 `./scripts/restart.sh`
- 禁止 rm/unlink；无浏览器自动化

## Tasks

- [ ] T1 `dbconfig`：读/写 `AVATAR_DB_*`，绝对路径 sqlite DSN
- [ ] T2 `dbmigrate`：表白名单拷贝 + progress
- [ ] T3 docker/mysql probe + restart helper
- [ ] T4 HTTP routes setup + admin
- [ ] T5 前端 logos + EngineOnboarding phase `db`
- [ ] T6 `DbSettings.jsx` + App Fold
- [ ] T7 测试迁库往返 + 手动冒烟

---
