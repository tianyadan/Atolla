package githubidea

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const maxGitHubResponseBytes = 2 << 20

type httpDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

func defaultHTTPClient() httpDoer { return &http.Client{Timeout: 20 * time.Second} }

// EventInput 是中继透传的 GitHub Webhook 原始请求。
type EventInput struct {
	DeliveryID string
	Event      string
	Signature  string
	Body       []byte
}

// Idea 是从 Issue 标题和正文整理出的单条灵感。
type Idea struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

// PreparedEvent 是校验 Webhook 并解析 Issue 后的派发输入。
type PreparedEvent struct {
	DeliveryID    string
	Action        string
	Repository    string
	IssueNumber   int
	IssueTitle    string
	IssueURL      string
	IssueRevision string
	Labels        []string
	Assignees     []string
	DeadlineAt    *time.Time
	Ideas         []Idea
	AgentIDs      []int64
}

type issueWebhook struct {
	Action     string `json:"action"`
	Repository struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
	Issue struct {
		Number    int    `json:"number"`
		Title     string `json:"title"`
		Body      string `json:"body"`
		HTMLURL   string `json:"html_url"`
		UpdatedAt string `json:"updated_at"`
		Labels    []struct {
			Name string `json:"name"`
		} `json:"labels"`
		Assignees []struct {
			Login string `json:"login"`
		} `json:"assignees"`
		Milestone *struct {
			DueOn string `json:"due_on"`
		} `json:"milestone"`
	} `json:"issue"`
}

// PrepareEvent 在本机完成签名、仓库校验，并直接读取 Issue 标题与正文。
func (m *Manager) PrepareEvent(ctx context.Context, input EventInput) (PreparedEvent, error) {
	if !strings.EqualFold(strings.TrimSpace(input.Event), "issues") {
		return PreparedEvent{}, fmt.Errorf("unsupported GitHub event: %s", input.Event)
	}
	m.mu.RLock()
	cfg := cloneConfig(m.cfg)
	loadErr := m.loadErr
	m.mu.RUnlock()
	if loadErr != nil {
		return PreparedEvent{}, loadErr
	}
	if !cfg.Enabled {
		return PreparedEvent{}, fmt.Errorf("GitHub Idea 插件未启用")
	}
	secret, ok, err := m.secrets.Get(ctx, webhookSecretKey)
	if err != nil {
		return PreparedEvent{}, err
	}
	if !ok || strings.TrimSpace(secret) == "" {
		return PreparedEvent{}, fmt.Errorf("Webhook Secret 未配置")
	}
	if !verifyWebhookSignature([]byte(secret), input.Body, input.Signature) {
		return PreparedEvent{}, fmt.Errorf("GitHub Webhook 签名校验失败")
	}

	var payload issueWebhook
	if err := json.Unmarshal(input.Body, &payload); err != nil {
		return PreparedEvent{}, fmt.Errorf("解析 GitHub Webhook 失败: %w", err)
	}
	action := strings.ToLower(strings.TrimSpace(payload.Action))
	if action != "opened" && action != "edited" && action != "reopened" {
		return PreparedEvent{}, fmt.Errorf("unsupported issues action: %s", action)
	}
	repository := strings.TrimSpace(payload.Repository.FullName)
	if !strings.EqualFold(repository, cfg.Repository) {
		return PreparedEvent{}, fmt.Errorf("Webhook 仓库不匹配: %s", repository)
	}
	issueNumber := payload.Issue.Number
	if issueNumber <= 0 {
		return PreparedEvent{}, fmt.Errorf("issue number required")
	}
	title := strings.TrimSpace(payload.Issue.Title)
	content := strings.TrimSpace(payload.Issue.Body)
	if content == "" {
		content = title
	}
	if content == "" {
		return PreparedEvent{}, fmt.Errorf("Issue 标题和正文不能为空")
	}
	revision := strings.TrimSpace(payload.Issue.UpdatedAt)
	if revision == "" {
		revision = strings.TrimSpace(input.DeliveryID)
	}
	idea := Idea{ID: fmt.Sprintf("ISSUE-%d", issueNumber), Title: title, Content: content}
	labels := make([]string, 0, len(payload.Issue.Labels))
	for _, label := range payload.Issue.Labels {
		if name := strings.TrimSpace(label.Name); name != "" {
			labels = append(labels, name)
		}
	}
	assignees := make([]string, 0, len(payload.Issue.Assignees))
	for _, assignee := range payload.Issue.Assignees {
		if login := strings.TrimSpace(assignee.Login); login != "" {
			assignees = append(assignees, login)
		}
	}
	var deadlineAt *time.Time
	if payload.Issue.Milestone != nil && strings.TrimSpace(payload.Issue.Milestone.DueOn) != "" {
		if due, err := time.Parse(time.RFC3339, strings.TrimSpace(payload.Issue.Milestone.DueOn)); err == nil {
			deadlineAt = &due
		}
	}
	return PreparedEvent{
		DeliveryID: strings.TrimSpace(input.DeliveryID), Action: action, Repository: repository,
		IssueNumber: issueNumber, IssueTitle: title, IssueURL: strings.TrimSpace(payload.Issue.HTMLURL),
		IssueRevision: revision, Labels: labels, Assignees: assignees, DeadlineAt: deadlineAt,
		Ideas: []Idea{idea}, AgentIDs: append([]int64(nil), cfg.AgentIDs...),
	}, nil
}

func verifyWebhookSignature(secret, body []byte, signature string) bool {
	signature = strings.TrimSpace(signature)
	if !strings.HasPrefix(signature, "sha256=") {
		return false
	}
	got, err := hex.DecodeString(strings.TrimPrefix(signature, "sha256="))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write(body)
	return hmac.Equal(got, mac.Sum(nil))
}

func (m *Manager) githubAPI(ctx context.Context, token, method, endpoint string, body io.Reader) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "Atolla-GitHub-Idea")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := m.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxGitHubResponseBytes))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return raw, resp.StatusCode, nil
}
