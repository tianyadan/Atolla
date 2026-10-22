package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/engineusage"
)

func TestAdminEnginesUsageRequiresJWT(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := testAuthHandler()
	r := gin.New()
	h.Register(r)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/admin/engines/usage", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", w.Code)
	}
}

func TestAdminEnginesUsageReturnsThreeEngines(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engineusage.ClearCacheForTest()
	engineusage.SetHomeDir(t.TempDir())
	engineusage.SetCodexHome(t.TempDir())

	h := testAuthHandler()
	r := gin.New()
	h.Register(r)

	token := loginToken(t, r)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/admin/engines/usage", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		TTLSeconds int `json:"ttl_seconds"`
		Engines    []struct {
			ID    string `json:"id"`
			OK    bool   `json:"ok"`
			Error string `json:"error"`
		} `json:"engines"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.TTLSeconds != 300 {
		t.Fatalf("ttl=%d want 300", resp.TTLSeconds)
	}
	if len(resp.Engines) != 3 {
		t.Fatalf("engines=%d", len(resp.Engines))
	}
	want := []string{"claude", "codex", "cursor"}
	for i, id := range want {
		if resp.Engines[i].ID != id {
			t.Fatalf("engine[%d]=%s want %s", i, resp.Engines[i].ID, id)
		}
		if resp.Engines[i].OK {
			t.Fatalf("engine %s should fail without local creds", id)
		}
	}
}

func loginToken(t *testing.T, r *gin.Engine) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": "tianhaowen", "password": "12345678"})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("login %d", w.Code)
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Token
}
