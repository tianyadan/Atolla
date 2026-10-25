package service

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"atolla/server/internal/store"
)

// UpdateManagedAgentPreservingMemory 更新数字员工；若工作区路径变更，
// 保留引擎 session / 平台对话，并迁移 projects/ 项目记忆到新目录。
func (s *Service) UpdateManagedAgentPreservingMemory(ctx context.Context, id int64, in store.ManagedAgentInput) (*store.ManagedAgent, error) {
	before, err := s.Store.GetManagedAgent(ctx, id)
	if err != nil || before == nil {
		if before == nil && err == nil {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	oldWS := strings.TrimSpace(before.WorkspacePath)
	newWS := oldWS
	if in.WorkspacePath != nil {
		newWS = strings.TrimSpace(*in.WorkspacePath)
	}

	if err := s.Store.UpdateManagedAgent(ctx, id, in); err != nil {
		return nil, err
	}

	oldNorm := normalizeWorkspacePath(oldWS)
	newNorm := normalizeWorkspacePath(newWS)
	changed := oldNorm != newNorm && (oldNorm != "" || newNorm != "")
	if changed {
		migrated := 0
		if oldNorm != "" && newNorm != "" {
			migrated = migrateProjectsDir(oldNorm, newNorm)
		}
		if before.ConversationID > 0 {
			_ = s.Store.SetConversationNeedsSystemReinject(ctx, before.ConversationID, true)
			note := workspaceChangeNote(oldWS, newWS, migrated)
			_, _ = s.Store.InsertMessage(ctx, &store.Message{
				ConversationID:     before.ConversationID,
				Role:               "system",
				Content:            note,
				Status:             "ok",
				WorkspacePath:      newWS,
				ExcludeFromContext: true, // 仅 UI 提示，避免重复占上下文；下一轮靠 reinject + 历史补强
			})
		}
	}

	return s.Store.GetManagedAgent(ctx, id)
}

func workspaceChangeNote(oldWS, newWS string, migrated int) string {
	from := oldWS
	if from == "" {
		from = "（未绑定）"
	}
	to := newWS
	if to == "" {
		to = "（未绑定）"
	}
	msg := fmt.Sprintf("📂 工作区已从「%s」切换为「%s」。对话历史与引擎会话已保留，不会因换目录失忆。", from, to)
	if migrated > 0 {
		msg += fmt.Sprintf(" 已迁移 %d 个项目记忆目录到新工作区 projects/。", migrated)
	} else if oldWS != "" && newWS != "" {
		msg += " 未发现可迁移的 projects/（或目标已存在同名目录）。"
	}
	return msg
}

func normalizeWorkspacePath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return filepath.Clean(p)
	}
	return abs
}

// migrateProjectsDir 将旧工作区 projects/ 下子目录复制到新工作区（目标已存在则跳过，不覆盖）。
// 返回成功迁移的子目录数量。
func migrateProjectsDir(oldRoot, newRoot string) int {
	src := filepath.Join(oldRoot, "projects")
	dstRoot := filepath.Join(newRoot, "projects")
	entries, err := os.ReadDir(src)
	if err != nil {
		return 0
	}
	if err := os.MkdirAll(dstRoot, 0o755); err != nil {
		return 0
	}
	n := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		from := filepath.Join(src, name)
		to := filepath.Join(dstRoot, name)
		if st, err := os.Stat(to); err == nil && st.IsDir() {
			continue
		}
		if err := copyDirRecursive(from, to); err != nil {
			continue
		}
		n++
	}
	return n
}

func copyDirRecursive(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		return copyFile(path, target, info.Mode())
	})
}

func copyFile(src, dst string, mode fs.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode.Perm())
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
