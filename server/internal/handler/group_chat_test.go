package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// TestAdminGroupChatsCreateRequiresJWT 建群接口需管理员 JWT。
func TestAdminGroupChatsCreateRequiresJWT(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := testAuthHandler()
	r := gin.New()
	h.Register(r)

	body, _ := json.Marshal(map[string]any{
		"from_agent_id": 1,
		"member_ids":    []int64{2, 3},
		"seed_question": "hello",
	})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/group-chats", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", w.Code)
	}
}
