package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"atolla/server/config"
	"atolla/server/internal/service"
	"atolla/server/internal/teamstream"
)

func TestTeamStreamRequiresJWT(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{svc: &service.Service{
		Cfg:     config.Config{JWTSecret: "test-jwt-secret", AdminUser: "tianhaowen", AdminPass: "12345678"},
		TeamHub: teamstream.NewHub(8),
	}}
	r := gin.New()
	h.Register(r)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/teams/0/stream", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", w.Code)
	}
}

func TestParseLastEventID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/teams/1/stream", nil)
	c.Request.Header.Set("Last-Event-ID", "42")
	if parseLastEventID(c) != 42 {
		t.Fatal("header")
	}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/teams/1/stream?lastEventId=9", nil)
	if parseLastEventID(c) != 9 {
		t.Fatal("query")
	}
}
