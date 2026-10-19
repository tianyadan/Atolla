package remotebridge

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestStagePendingPasswordSurvivesBeforeCommit 保证新密码先写入文件，正式密码仍是旧值。
func TestStagePendingPasswordSurvivesBeforeCommit(t *testing.T) {
	dir := t.TempDir()
	cs, err := NewConfigStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cs.Update(Config{
		Enabled:     true,
		BaseURL:     "http://127.0.0.1:9",
		InstanceID:  "inst-1",
		DisplayName: "mac",
		Password:    "Old111",
	}); err != nil {
		t.Fatal(err)
	}
	if err := cs.StagePendingPassword("New222"); err != nil {
		t.Fatal(err)
	}

	reloaded, err := NewConfigStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := reloaded.Get()
	if got.Password != "Old111" || got.PendingPassword != "New222" {
		t.Fatalf("staged config = %+v", got)
	}

	raw, err := os.ReadFile(filepath.Join(dir, ".atolla", "remote-relay.json"))
	if err != nil {
		t.Fatal(err)
	}
	var disk Config
	if err := json.Unmarshal(raw, &disk); err != nil {
		t.Fatal(err)
	}
	if disk.PendingPassword != "New222" {
		t.Fatalf("disk pending = %q", disk.PendingPassword)
	}

	if err := reloaded.SetPassword("New222"); err != nil {
		t.Fatal(err)
	}
	got = reloaded.Get()
	if got.Password != "New222" || got.PendingPassword != "" {
		t.Fatalf("committed config = %+v", got)
	}
}
