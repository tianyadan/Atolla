package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestSQLiteNewMigrates(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "atolla.db")
	st, err := NewWithDriver(DriverSQLite, path)
	if err != nil {
		t.Fatalf("NewWithDriver: %v", err)
	}
	if st.Driver() != DriverSQLite {
		t.Fatalf("driver=%s", st.Driver())
	}
	ctx := context.Background()
	ok, err := st.hasTable(ctx, "managed_agents")
	if err != nil || !ok {
		t.Fatalf("managed_agents ok=%v err=%v", ok, err)
	}
	ok, err = st.hasTable(ctx, "skill_catalog")
	if err != nil || !ok {
		t.Fatalf("skill_catalog ok=%v err=%v", ok, err)
	}
}

// TestSQLiteRuntimeCRUD 覆盖消息写入、技能安装、任务 upsert 等运行时 SQL。
func TestSQLiteRuntimeCRUD(t *testing.T) {
	dir := t.TempDir()
	st, err := NewWithDriver(DriverSQLite, filepath.Join(dir, "rt.db"))
	if err != nil {
		t.Fatalf("NewWithDriver: %v", err)
	}
	ctx := context.Background()

	convID, err := st.CreateConversation(ctx, "127.0.0.1", "smoke")
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	msg := &Message{
		ConversationID: convID,
		Role:           "user",
		Content:        "hi",
		Status:         "done",
		MetaJSON:       `{"k":"v"}`,
	}
	if _, err := st.InsertMessage(ctx, msg); err != nil {
		t.Fatalf("InsertMessage: %v", err)
	}
	msgs, err := st.Messages(ctx, convID)
	if err != nil || len(msgs) != 1 {
		t.Fatalf("Messages: n=%d err=%v", len(msgs), err)
	}
	if msgs[0].MetaJSON != `{"k":"v"}` {
		t.Fatalf("meta corrupted: %q", msgs[0].MetaJSON)
	}

	agentID, err := st.CreateManagedAgent(ctx, ManagedAgentInput{
		Name: "smoke-agent", Engine: "claude",
	})
	if err != nil {
		t.Fatalf("CreateManagedAgent: %v", err)
	}
	var sid string
	if err := st.db.QueryRowContext(ctx, `SELECT id FROM skill_catalog LIMIT 1`).Scan(&sid); err != nil || sid == "" {
		t.Fatalf("no skill_catalog seed: %v", err)
	}
	if err := st.InstallAgentSkill(ctx, agentID, sid, "test", nil); err != nil {
		t.Fatalf("InstallAgentSkill: %v", err)
	}
	if err := st.InstallAgentSkill(ctx, agentID, sid, "test2", nil); err != nil {
		t.Fatalf("InstallAgentSkill upsert: %v", err)
	}

	if _, err := st.UpsertAgentTask(ctx, AgentTaskReport{
		AgentType: "managed", AgentID: "1", TaskID: "t1",
		TaskName: "smoke", Status: "running", Progress: 10, Message: "ok",
		Payload: map[string]any{"a": 1},
	}); err != nil {
		t.Fatalf("UpsertAgentTask: %v", err)
	}
	if _, err := st.UpsertAgentTask(ctx, AgentTaskReport{
		AgentType: "managed", AgentID: "1", TaskID: "t1",
		TaskName: "smoke", Status: "done", Progress: 100, Message: "done",
	}); err != nil {
		t.Fatalf("UpsertAgentTask update: %v", err)
	}

	defID, err := st.CreateWorkflowDefinition(ctx, "wf", "desc", `{"nodes":[],"edges":[]}`)
	if err != nil {
		t.Fatalf("CreateWorkflowDefinition: %v", err)
	}
	if err := st.UpdateWorkflowDefinition(ctx, defID, "wf2", "d2", `{"nodes":[1],"edges":[]}`); err != nil {
		t.Fatalf("UpdateWorkflowDefinition: %v", err)
	}

	if _, err := st.UpsertTestServerAllowedIP(ctx, "10.0.0.1", "lab"); err != nil {
		t.Fatalf("UpsertTestServerAllowedIP: %v", err)
	}
	if _, err := st.UpsertTestServerAllowedIP(ctx, "10.0.0.1", "lab2"); err != nil {
		t.Fatalf("UpsertTestServerAllowedIP update: %v", err)
	}

	// agent_occupancy：SQLite 须用 INSERT OR IGNORE，不能用 MySQL 的 INSERT IGNORE
	ok, err := st.TryInsertOccupancy(ctx, Occupancy{
		AgentID: agentID, SourceType: "CHAT", SourceID: "c1", SourceName: "smoke", TaskName: "ask",
	})
	if err != nil || !ok {
		t.Fatalf("TryInsertOccupancy: ok=%v err=%v", ok, err)
	}
	ok, err = st.TryInsertOccupancy(ctx, Occupancy{
		AgentID: agentID, SourceType: "CHAT", SourceID: "c2", SourceName: "dup", TaskName: "ask2",
	})
	if err != nil {
		t.Fatalf("TryInsertOccupancy conflict: %v", err)
	}
	if ok {
		t.Fatal("expected conflict occupancy to be ignored")
	}
	if err := st.ClearOccupancy(ctx, agentID); err != nil {
		t.Fatalf("ClearOccupancy: %v", err)
	}
}
