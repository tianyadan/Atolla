package githubidea

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// WriteBackStatus 将任务终态作为评论回写到来源 Issue。
func (m *Manager) WriteBackStatus(ctx context.Context, binding IdeaBinding, status, reason string) error {
	token, ok, err := m.secrets.Get(ctx, githubTokenKey)
	if err != nil {
		return err
	}
	if !ok || strings.TrimSpace(token) == "" {
		return fmt.Errorf("GitHub 凭据未配置")
	}
	return m.writeIssueComment(ctx, token, binding, status, reason)
}

func (m *Manager) writeIssueComment(ctx context.Context, token string, binding IdeaBinding, status, reason string) error {
	if strings.TrimSpace(binding.Repository) == "" || binding.IssueNumber <= 0 {
		return fmt.Errorf("Idea %s 缺少 Issue 来源", binding.IdeaID)
	}
	body := buildStatusBlock(binding.IdeaID, status, reason, time.Now())
	payload, _ := json.Marshal(map[string]string{"body": body})
	endpoint := fmt.Sprintf("%s/repos/%s/issues/%d/comments", strings.TrimRight(m.apiBase, "/"), binding.Repository, binding.IssueNumber)
	_, code, err := m.githubAPI(ctx, token, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("回写 Issue 评论失败: %w", err)
	}
	if code != http.StatusCreated {
		return fmt.Errorf("回写 Issue 评论失败: GitHub API %d", code)
	}
	return nil
}

func buildStatusBlock(ideaID, status, reason string, at time.Time) string {
	status = strings.ToLower(strings.TrimSpace(status))
	label := "处理中"
	symbol := "⏳"
	switch status {
	case "done", "completed", "success":
		label, symbol = "已完成", "✅"
	case "failed", "error":
		label, symbol = "执行失败", "❌"
	case "cancelled", "canceled":
		label, symbol = "已取消", "⏹"
	}
	lines := []string{
		fmt.Sprintf("<!-- atolla:idea-status %s -->", strings.ToUpper(strings.TrimSpace(ideaID))),
		fmt.Sprintf("> Atolla 状态：%s %s", symbol, label),
		fmt.Sprintf("> 更新时间：%s", at.UTC().Format(time.RFC3339)),
	}
	if status == "failed" || status == "error" || status == "cancelled" || status == "canceled" {
		reason = strings.TrimSpace(reason)
		if reason == "" {
			reason = "未提供失败原因"
		}
		if len(reason) > 2000 {
			reason = reason[:2000] + "…"
		}
		reason = strings.ReplaceAll(strings.ReplaceAll(reason, "\r\n", "\n"), "\r", "\n")
		lines = append(lines, "> 失败原因："+strings.ReplaceAll(reason, "\n", "<br>"))
	}
	lines = append(lines, "<!-- /atolla:idea-status -->")
	return strings.Join(lines, "\n")
}
