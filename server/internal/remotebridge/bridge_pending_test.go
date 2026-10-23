package remotebridge

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"atolla/server/internal/store"
)

// TestAdoptStagedPasswordPromotesAcceptedSecret 当前密码被拒、待定密码被接受时，文件应改成待定密码。
func TestAdoptStagedPasswordPromotesAcceptedSecret(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Instance-Password") == "New222" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
	}))
	defer srv.Close()

	dir := t.TempDir()
	cs, err := NewConfigStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cs.Update(Config{
		Enabled:     true,
		BaseURL:     srv.URL,
		InstanceID:  "inst-1",
		DisplayName: "mac",
		Password:    "Old111",
	}); err != nil {
		t.Fatal(err)
	}
	if err := cs.StagePendingPassword("New222"); err != nil {
		t.Fatal(err)
	}

	b := NewBridge(cs, &store.Store{})
	cfg, hb, ok := b.adoptStagedPassword(context.Background(), cs.Get(), []string{"ping"}, false, errString("relay 401 Unauthorized: Unauthorized"))
	if !ok || hb == nil || !hb.OK {
		t.Fatalf("adopt ok=%v hb=%v", ok, hb)
	}
	if cfg.Password != "New222" || cfg.PendingPassword != "" {
		t.Fatalf("promoted config = %+v", cfg)
	}
}

type errString string

func (e errString) Error() string { return string(e) }
