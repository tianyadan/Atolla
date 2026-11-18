package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestDebugSQLiteMigrateSteps(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "m.db")
	db, err := openDB(DriverSQLite, path)
	if err != nil {
		t.Fatal(err)
	}
	s := &Store{db: db, driver: DriverSQLite}
	ctx := context.Background()
	steps := []struct {
		name string
		fn   func(context.Context) error
	}{
		{"bootstrap", s.bootstrapSQLite},
		{"seed", s.seedDataQueryWorkspace},
		{"perm", s.ensurePermissionGatewaySchema},
		{"recv", s.ensureReceptionistSchema},
		{"ask", s.ensureAgentAskAuditSchema},
		{"skill", s.EnsureSkillSchema},
		{"dbsrc", s.EnsureDBSourceSchema},
		{"ssrc", s.EnsureServerSourceSchema},
		{"auto", s.EnsureAutoApproveSchema},
		{"legacy", s.EnsureLegacyMemorySchema},
		{"net", s.EnsureNetworkAllowlistSchema},
		{"notify", s.EnsureNotifyPrefsSchema},
		{"admin", s.EnsureAdminAccountSchema},
		{"jelly", s.EnsureJellyColorSchema},
		{"group", s.EnsureGroupChatSchema},
		{"unread", s.EnsureTaskUnreadSchema},
		{"taskq", s.EnsureAgentTaskQueueSchema},
	}
	for _, st := range steps {
		if err := st.fn(ctx); err != nil {
			t.Fatalf("step %s: %v", st.name, err)
		}
		t.Logf("ok %s", st.name)
	}
}
