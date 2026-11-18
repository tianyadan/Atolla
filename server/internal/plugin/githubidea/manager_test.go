package githubidea

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type memorySecrets map[string]string

func (s memorySecrets) Get(_ context.Context, key string) (string, bool, error) {
	v, ok := s[key]
	return v, ok, nil
}

func (s memorySecrets) Set(_ context.Context, key, value string) error {
	s[key] = value
	return nil
}

func TestManagerStoresSecretsOutsideConfig(t *testing.T) {
	root := t.TempDir()
	secrets := memorySecrets{}
	m := newManager(root, secrets)
	out, err := m.Update(context.Background(), ConfigUpdate{
		Enabled: true, Repository: "atolla/ideas", GitHubToken: "github-token-value",
		WebhookSecret: "webhook-secret-value", AgentIDs: []int64{9, 2, 9},
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != "ready" || !out.HasGitHubToken || !out.HasWebhookSecret {
		t.Fatalf("unexpected public config: %+v", out)
	}
	if len(out.AgentIDs) != 2 || out.AgentIDs[0] != 2 || out.AgentIDs[1] != 9 {
		t.Fatalf("agent ids not normalized: %v", out.AgentIDs)
	}
	b, err := os.ReadFile(filepath.Join(root, ".atolla", "plugins", "github-idea.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "github-token-value") || strings.Contains(string(b), "webhook-secret-value") {
		t.Fatalf("secret leaked into config: %s", b)
	}
	var saved diskConfig
	if err := json.Unmarshal(b, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Repository != "atolla/ideas" || !saved.Enabled {
		t.Fatalf("unexpected saved config: %+v", saved)
	}
}

func TestManagerRequiresCompleteConfigBeforeEnable(t *testing.T) {
	m := newManager(t.TempDir(), memorySecrets{})
	_, err := m.Update(context.Background(), ConfigUpdate{Enabled: true, Repository: "atolla/ideas", AgentIDs: []int64{1}})
	if err == nil || !strings.Contains(err.Error(), "GitHub 凭据") {
		t.Fatalf("expected credential validation error, got %v", err)
	}
}

func TestPublicConfigDetectsMissingKeychainCredential(t *testing.T) {
	out := publicConfig(diskConfig{Enabled: true, Repository: "atolla/ideas", AgentIDs: []int64{1}}, false, true, nil)
	if out.Status != "error" || !strings.Contains(out.LastError, "GitHub 凭据") {
		t.Fatalf("unexpected status: %+v", out)
	}
}

func TestDisabledPluginStaysIsolatedAndCanBeEnabledAgain(t *testing.T) {
	root := t.TempDir()
	secrets := memorySecrets{githubTokenKey: "token", webhookSecretKey: "secret"}
	m := newManager(root, secrets)
	if err := m.RecordError("旧的插件错误"); err != nil {
		t.Fatal(err)
	}
	out, err := m.Update(context.Background(), ConfigUpdate{Enabled: false, Repository: "acme/ideas", AgentIDs: []int64{7}})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != "disabled" {
		t.Fatalf("disabled plugin reported %q", out.Status)
	}
	if _, err := m.PrepareEvent(context.Background(), EventInput{Event: "issues"}); err == nil || !strings.Contains(err.Error(), "未启用") {
		t.Fatalf("disabled plugin accepted event: %v", err)
	}
	out, err = m.Update(context.Background(), ConfigUpdate{Enabled: true, Repository: "acme/ideas", AgentIDs: []int64{7}})
	if err != nil || out.Status != "error" {
		// 重新启用后保留历史故障，下一次成功同步负责清除。
		t.Fatalf("re-enable status=%q err=%v", out.Status, err)
	}
	if err := m.RecordSyncSuccess(time.Now()); err != nil {
		t.Fatal(err)
	}
	out, err = m.Get(context.Background())
	if err != nil || out.Status != "ready" || out.LastError != "" {
		t.Fatalf("successful recovery not reflected: %+v err=%v", out, err)
	}
}

func TestPrepareEventVerifiesSignatureAndReadsIssue(t *testing.T) {
	secrets := memorySecrets{}
	m := newManager(t.TempDir(), secrets)
	_, err := m.Update(context.Background(), ConfigUpdate{
		Enabled: true, Repository: "acme/ideas", GitHubToken: "token",
		WebhookSecret: "hook-secret", AgentIDs: []int64{7},
	})
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"action":"opened","repository":{"full_name":"acme/ideas"},"issue":{"number":12,"title":"Improve picker","body":"Use a single-column dialog.","html_url":"https://github.com/acme/ideas/issues/12","updated_at":"2026-11-08T10:00:00Z","labels":[{"name":"frontend"},{"name":"priority:high"}],"assignees":[{"login":"octocat"}],"milestone":{"due_on":"2026-11-20T08:00:00Z"}}}`)
	mac := hmac.New(sha256.New, []byte("hook-secret"))
	_, _ = mac.Write(body)
	prepared, err := m.PrepareEvent(context.Background(), EventInput{
		DeliveryID: "delivery-1", Event: "issues", Signature: "sha256=" + fmt.Sprintf("%x", mac.Sum(nil)), Body: body,
	})
	if err != nil {
		t.Fatal(err)
	}
	if prepared.IssueNumber != 12 || prepared.IssueRevision != "2026-11-08T10:00:00Z" || len(prepared.Ideas) != 1 {
		t.Fatalf("unexpected prepared event: %+v", prepared)
	}
	if idea := prepared.Ideas[0]; idea.ID != "ISSUE-12" || idea.Title != "Improve picker" || idea.Content != "Use a single-column dialog." {
		t.Fatalf("unexpected prepared event: %+v", prepared)
	}
	if len(prepared.Labels) != 2 || prepared.Labels[0] != "frontend" || len(prepared.Assignees) != 1 || prepared.Assignees[0] != "octocat" {
		t.Fatalf("issue metadata missing: %+v", prepared)
	}
	if prepared.DeadlineAt == nil || prepared.DeadlineAt.Format(time.RFC3339) != "2026-11-20T08:00:00Z" {
		t.Fatalf("deadline missing: %+v", prepared.DeadlineAt)
	}
}

func TestPrepareEventRejectsBadSignature(t *testing.T) {
	m := newManager(t.TempDir(), memorySecrets{githubTokenKey: "token", webhookSecretKey: "secret"})
	m.cfg = diskConfig{Enabled: true, Repository: "acme/ideas", AgentIDs: []int64{1}}
	_, err := m.PrepareEvent(context.Background(), EventInput{Event: "issues", Signature: "sha256=00", Body: []byte(`{}`)})
	if err == nil || !strings.Contains(err.Error(), "签名校验失败") {
		t.Fatalf("expected signature error, got %v", err)
	}
}

func TestIdeaDedupClaimCompleteAndRelease(t *testing.T) {
	m := newManager(t.TempDir(), memorySecrets{})
	claimed, err := m.ClaimIdea("acme/ideas#idea-1", "delivery-1")
	if err != nil || !claimed {
		t.Fatalf("first claim: claimed=%v err=%v", claimed, err)
	}
	claimed, err = m.ClaimIdea("acme/ideas#IDEA-1", "delivery-2")
	if err != nil || claimed {
		t.Fatalf("duplicate claim: claimed=%v err=%v", claimed, err)
	}
	if err := m.ReleaseIdea("acme/ideas#idea-1"); err != nil {
		t.Fatal(err)
	}
	claimed, err = m.ClaimIdea("acme/ideas#idea-1", "delivery-3")
	if err != nil || !claimed {
		t.Fatalf("claim after release: claimed=%v err=%v", claimed, err)
	}
	if err := m.CompleteIdea("acme/ideas#idea-1", "42", IdeaBinding{IdeaID: "IDEA-1"}); err != nil {
		t.Fatal(err)
	}
	claimed, err = m.ClaimIdea("acme/ideas#idea-1", "delivery-4")
	if err != nil || claimed {
		t.Fatalf("claim after complete: claimed=%v err=%v", claimed, err)
	}
}

func TestWriteBackStatusCreatesIssueComment(t *testing.T) {
	commentCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/acme/ideas/issues/12/comments" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request: %s", r.URL.String())
		}
		commentCount++
		var payload struct {
			Body string `json:"body"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(payload.Body, "ISSUE-12") || !strings.Contains(payload.Body, "执行失败") || !strings.Contains(payload.Body, "构建失败") {
			t.Fatalf("unexpected issue comment: %s", payload.Body)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	m := newManager(t.TempDir(), memorySecrets{githubTokenKey: "token"})
	m.apiBase = server.URL
	m.httpClient = server.Client()
	err := m.WriteBackStatus(context.Background(), IdeaBinding{
		Repository: "acme/ideas", IssueNumber: 12, IdeaID: "ISSUE-12",
	}, "failed", "构建失败")
	if err != nil {
		t.Fatal(err)
	}
	if commentCount != 1 {
		t.Fatalf("unexpected comment count: %d", commentCount)
	}
}

func TestClaimWritebackPreventsDuplicateAndRetriesFailure(t *testing.T) {
	m := newManager(t.TempDir(), memorySecrets{})
	if claimed, err := m.ClaimIdea("acme/ideas#idea-1", "delivery-1"); err != nil || !claimed {
		t.Fatalf("claim idea: claimed=%v err=%v", claimed, err)
	}
	binding := IdeaBinding{Repository: "acme/ideas", IssueNumber: 1, IdeaID: "ISSUE-1"}
	if err := m.CompleteIdea("acme/ideas#idea-1", "task-1", binding); err != nil {
		t.Fatal(err)
	}
	got, claimed, err := m.ClaimWriteback("task-1", "failed")
	if err != nil || !claimed || got.IdeaID != binding.IdeaID {
		t.Fatalf("first writeback claim: binding=%+v claimed=%v err=%v", got, claimed, err)
	}
	if _, claimed, err = m.ClaimWriteback("task-1", "failed"); err != nil || claimed {
		t.Fatalf("processing writeback claimed twice: claimed=%v err=%v", claimed, err)
	}
	if err := m.FinishWriteback("task-1", false); err != nil {
		t.Fatal(err)
	}
	if _, claimed, err = m.ClaimWriteback("task-1", "failed"); err != nil || !claimed {
		t.Fatalf("failed writeback was not retryable: claimed=%v err=%v", claimed, err)
	}
	if err := m.FinishWriteback("task-1", true); err != nil {
		t.Fatal(err)
	}
	if _, claimed, err = m.ClaimWriteback("task-1", "failed"); err != nil || claimed {
		t.Fatalf("completed writeback was claimed again: claimed=%v err=%v", claimed, err)
	}
}

func TestDedupAndWritebackStateSurviveRestart(t *testing.T) {
	root := t.TempDir()
	m := newManager(root, memorySecrets{})
	if claimed, err := m.ClaimIdea("acme/ideas#idea-9", "delivery-9"); err != nil || !claimed {
		t.Fatalf("claim idea: claimed=%v err=%v", claimed, err)
	}
	if err := m.CompleteIdea("acme/ideas#idea-9", "task-9", IdeaBinding{IdeaID: "IDEA-9"}); err != nil {
		t.Fatal(err)
	}
	if _, claimed, err := m.ClaimWriteback("task-9", "done"); err != nil || !claimed {
		t.Fatalf("claim writeback: claimed=%v err=%v", claimed, err)
	}
	if err := m.FinishWriteback("task-9", true); err != nil {
		t.Fatal(err)
	}

	reloaded := newManager(root, memorySecrets{})
	if claimed, err := reloaded.ClaimIdea("acme/ideas#idea-9", "delivery-retry"); err != nil || claimed {
		t.Fatalf("completed idea was redispatched after restart: claimed=%v err=%v", claimed, err)
	}
	if _, claimed, err := reloaded.ClaimWriteback("task-9", "done"); err != nil || claimed {
		t.Fatalf("completed writeback repeated after restart: claimed=%v err=%v", claimed, err)
	}
}
