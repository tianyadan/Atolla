package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"atolla/server/internal/plugin/githubidea"
	"atolla/server/internal/store"
)

type githubIdeaMemorySecrets struct {
	mu     sync.RWMutex
	values map[string]string
}

func (s *githubIdeaMemorySecrets) Get(_ context.Context, key string) (string, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.values[key]
	return value, ok, nil
}

func (s *githubIdeaMemorySecrets) Set(_ context.Context, key, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.values == nil {
		s.values = map[string]string{}
	}
	s.values[key] = value
	return nil
}

func TestGitHubIdeaWebhookEndToEndIdempotencyLoadAndRestart(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dbPath := filepath.Join(root, "github-idea-integration.db")
	pluginRoot := filepath.Join(root, "workspace")
	secrets := &githubIdeaMemorySecrets{}
	st, err := store.NewWithDriver(store.DriverSQLite, dbPath)
	if err != nil {
		t.Fatal(err)
	}

	busyID := createDispatchTestAgent(t, st, "较忙后端", "后端")
	idleID := createDispatchTestAgent(t, st, "空闲后端", "后端")
	for _, agentID := range []int64{busyID, idleID} {
		if err := st.SetAgentTaskQueueHold(ctx, agentID, true); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.InsertAgentTaskQueue(ctx, store.AgentTaskQueueItem{
		AgentID: busyID, Status: store.TaskQueued, Question: "已有任务", Position: 1, CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	manager := configuredGitHubIdeaManager(t, pluginRoot, secrets, busyID, idleID)
	svc := &Service{Store: st, GitHubIdea: manager}

	body := githubIssueWebhookBody(t, 41, "修复 Go 后端 API", "请完善服务端接口", "2026-11-08T12:00:00Z")
	out, err := svc.HandleGitHubIdeaEvent(ctx, "delivery-first", "issues", webhookSignature("hook-secret", body), body)
	if err != nil {
		t.Fatalf("first webhook: %v", err)
	}
	assertDispatchResponse(t, out, 1, 0, 0)
	dispatches, err := st.ListTaskDispatches(ctx, "github_issue", 20)
	if err != nil || len(dispatches) != 1 || dispatches[0].AssignedAgentID != idleID || dispatches[0].QueueTaskID <= 0 {
		t.Fatalf("load-aware dispatches=%+v err=%v", dispatches, err)
	}

	out, err = svc.HandleGitHubIdeaEvent(ctx, "delivery-retry", "issues", webhookSignature("hook-secret", body), body)
	if err != nil {
		t.Fatalf("duplicate webhook: %v", err)
	}
	assertDispatchResponse(t, out, 0, 1, 0)
	if got := totalActiveTasks(t, st, busyID, idleID); got != 2 {
		t.Fatalf("duplicate created queue item, active=%d", got)
	}

	concurrentBody := githubIssueWebhookBody(t, 42, "修复 Go 后端并发接口", "并发幂等联调", "2026-11-08T12:05:00Z")
	const workers = 12
	var successCount atomic.Int32
	var firstErr atomic.Value
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			_, callErr := svc.HandleGitHubIdeaEvent(ctx, fmt.Sprintf("delivery-concurrent-%d", index), "issues", webhookSignature("hook-secret", concurrentBody), concurrentBody)
			if callErr != nil {
				firstErr.CompareAndSwap(nil, callErr)
				return
			}
			successCount.Add(1)
		}(i)
	}
	close(start)
	wg.Wait()
	if errValue := firstErr.Load(); errValue != nil {
		t.Fatalf("concurrent webhook returned error: %v", errValue)
	}
	if successCount.Load() != workers {
		t.Fatalf("successful concurrent calls=%d want=%d", successCount.Load(), workers)
	}
	if got := totalActiveTasks(t, st, busyID, idleID); got != 3 {
		t.Fatalf("concurrent delivery created duplicate queue items, active=%d", got)
	}
	dispatches, err = st.ListTaskDispatches(ctx, "github_issue", 20)
	if err != nil || len(dispatches) != 2 {
		t.Fatalf("concurrent dispatch history=%+v err=%v", dispatches, err)
	}

	if err := st.SQLDB().Close(); err != nil {
		t.Fatal(err)
	}
	st, err = store.NewWithDriver(store.DriverSQLite, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.SQLDB().Close() })
	restartedManager := githubidea.NewManagerWithSecretStore(pluginRoot, secrets)
	restartedSvc := &Service{Store: st, GitHubIdea: restartedManager}
	out, err = restartedSvc.HandleGitHubIdeaEvent(ctx, "delivery-after-restart", "issues", webhookSignature("hook-secret", concurrentBody), concurrentBody)
	if err != nil {
		t.Fatalf("webhook after restart: %v", err)
	}
	assertDispatchResponse(t, out, 0, 1, 0)
	if got := totalActiveTasks(t, st, busyID, idleID); got != 3 {
		t.Fatalf("restart lost idempotency, active=%d", got)
	}
}

func TestGitHubIdeaWebhookWithoutEligibleAgentStaysPending(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	st, err := store.NewWithDriver(store.DriverSQLite, filepath.Join(root, "pending.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.SQLDB().Close() })
	frontendID := createDispatchTestAgent(t, st, "前端员工", "前端")
	manager := configuredGitHubIdeaManager(t, filepath.Join(root, "workspace"), &githubIdeaMemorySecrets{}, frontendID)
	svc := &Service{Store: st, GitHubIdea: manager}
	body := githubIssueWebhookBody(t, 43, "修复 Go 后端 API", "没有符合岗位的员工", "2026-11-08T12:10:00Z")

	out, err := svc.HandleGitHubIdeaEvent(ctx, "delivery-no-candidate", "issues", webhookSignature("hook-secret", body), body)
	if err != nil {
		t.Fatalf("pending webhook: %v", err)
	}
	assertDispatchResponse(t, out, 0, 0, 1)
	dispatches, err := st.ListTaskDispatches(ctx, "github_issue", 20)
	if err != nil || len(dispatches) != 1 || dispatches[0].Status != store.TaskDispatchPendingAssignment || dispatches[0].QueueTaskID != 0 {
		t.Fatalf("pending dispatches=%+v err=%v", dispatches, err)
	}
	if got := totalActiveTasks(t, st, frontendID); got != 0 {
		t.Fatalf("ineligible agent received queue item, active=%d", got)
	}
}

func createDispatchTestAgent(t *testing.T, st *store.Store, name, role string) int64 {
	t.Helper()
	id, err := st.CreateManagedAgent(context.Background(), store.ManagedAgentInput{Name: name, Engine: "codex", JobRole: &role})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func configuredGitHubIdeaManager(t *testing.T, root string, secrets *githubIdeaMemorySecrets, agentIDs ...int64) *githubidea.Manager {
	t.Helper()
	manager := githubidea.NewManagerWithSecretStore(root, secrets)
	_, err := manager.Update(context.Background(), githubidea.ConfigUpdate{
		Enabled: true, Repository: "acme/ideas", GitHubToken: "token", WebhookSecret: "hook-secret", AgentIDs: agentIDs,
	})
	if err != nil {
		t.Fatal(err)
	}
	return manager
}

func githubIssueWebhookBody(t *testing.T, number int, title, body, updatedAt string) []byte {
	t.Helper()
	payload := map[string]any{
		"action":     "opened",
		"repository": map[string]any{"full_name": "acme/ideas"},
		"issue": map[string]any{
			"number": number, "title": title, "body": body,
			"html_url":   fmt.Sprintf("https://github.com/acme/ideas/issues/%d", number),
			"updated_at": updatedAt, "labels": []map[string]string{}, "assignees": []map[string]string{},
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func webhookSignature(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func assertDispatchResponse(t *testing.T, out any, dispatched, duplicates, pending int) {
	t.Helper()
	result, ok := out.(map[string]any)
	if !ok || result["dispatched"] != dispatched || result["duplicates"] != duplicates || result["pending_assignment"] != pending {
		t.Fatalf("response=%#v", out)
	}
}

func totalActiveTasks(t *testing.T, st *store.Store, agentIDs ...int64) int {
	t.Helper()
	total := 0
	for _, agentID := range agentIDs {
		count, err := st.CountAgentTaskActive(context.Background(), agentID)
		if err != nil {
			t.Fatal(err)
		}
		total += count
	}
	return total
}
