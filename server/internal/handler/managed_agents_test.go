package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"

	"atolla/server/config"
	"atolla/server/internal/service"
	"atolla/server/internal/store"
)

func newManagedAgentAPITest(t *testing.T) (*gin.Engine, *store.Store, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	st, err := store.NewWithDriver(store.DriverSQLite, filepath.Join(t.TempDir(), "managed-agent-api.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.SQLDB().Close() })
	cfg := config.Config{AdminUser: "admin", AdminPass: "12345678", JWTSecret: "managed-agent-test-secret", JWTTTLHours: 24}
	router := gin.New()
	New(&service.Service{Cfg: cfg, Store: st}).Register(router)
	loginBody, _ := json.Marshal(map[string]string{"username": cfg.AdminUser, "password": cfg.AdminPass})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)
	var login struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &login)
	if w.Code != http.StatusOK || login.Token == "" {
		t.Fatalf("login status=%d body=%s", w.Code, w.Body.String())
	}
	return router, st, login.Token
}

func TestAdminAgentsCreateRequiresJWT(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := testAuthHandler()
	r := gin.New()
	h.Register(r)

	body, _ := json.Marshal(map[string]string{"name": "dev", "engine": "claude"})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/agents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", w.Code)
	}
}

func TestAdminAgentsCreateRejectsBadEngine(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := testAuthHandler()
	r := gin.New()
	h.Register(r)

	// login
	loginBody, _ := json.Marshal(map[string]string{"username": "tianhaowen", "password": "12345678"})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	var lr struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &lr)
	if lr.Token == "" {
		t.Fatal("no token")
	}

	body, _ := json.Marshal(map[string]string{"name": "x", "engine": "cursor"})
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/admin/agents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+lr.Token)
	r.ServeHTTP(w, req)
	// Store is nil → may 500 after validation; bad engine should 400 before DB
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d body=%s, want 400", w.Code, w.Body.String())
	}
}

func TestAdminAgentsCopyRequiresJWT(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := testAuthHandler()
	r := gin.New()
	h.Register(r)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/agents/1/copy", bytes.NewReader([]byte(`{"name":"x"}`)))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", w.Code)
	}
}

func TestAdminAgentsCopyRejectsEmptyName(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := testAuthHandler()
	r := gin.New()
	h.Register(r)
	loginBody, _ := json.Marshal(map[string]string{"username": "tianhaowen", "password": "12345678"})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	var lr struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &lr)
	if lr.Token == "" {
		t.Fatal("no token")
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/admin/agents/1/copy", bytes.NewReader([]byte(`{"name":"  "}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+lr.Token)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d body=%s, want 400", w.Code, w.Body.String())
	}
}

func TestAdminAgentsCreatePersistsJobRole(t *testing.T) {
	router, st, token := newManagedAgentAPITest(t)
	body := []byte(`{"name":"后端员工","engine":"codex","job_role":"后端"}`)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/agents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", w.Code, w.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	agent, err := st.GetManagedAgent(context.Background(), created.ID)
	if err != nil || agent == nil || agent.JobRole != "后端" {
		t.Fatalf("created agent=%+v err=%v", agent, err)
	}
}

func TestAdminAgentsUpdatePersistsJobRole(t *testing.T) {
	router, st, token := newManagedAgentAPITest(t)
	id, err := st.CreateManagedAgent(context.Background(), store.ManagedAgentInput{Name: "待配置员工", Engine: "codex"})
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/agents/"+strconv.FormatInt(id, 10), bytes.NewReader([]byte(`{"job_role":"移动端"}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("update status=%d body=%s", w.Code, w.Body.String())
	}
	agent, err := st.GetManagedAgent(context.Background(), id)
	if err != nil || agent == nil || agent.JobRole != "移动端" {
		t.Fatalf("updated agent=%+v err=%v", agent, err)
	}
}
