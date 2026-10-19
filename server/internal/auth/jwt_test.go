package auth

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestIssueAndParseToken(t *testing.T) {
	secret := "test-secret"
	tok, err := IssueToken(secret, "tianhaowen", time.Hour)
	if err != nil {
		t.Fatalf("IssueToken: %v", err)
	}
	user, err := ParseToken(secret, tok)
	if err != nil {
		t.Fatalf("ParseToken: %v", err)
	}
	if user != "tianhaowen" {
		t.Fatalf("username = %q, want tianhaowen", user)
	}
}

// TestIssueTokenPayloadIsValidJSON 防止 JWT 载荷字段名前混入 NUL，导致后续管理接口全部鉴权失败。
func TestIssueTokenPayloadIsValidJSON(t *testing.T) {
	tok, err := IssueToken("test-secret", "tianhaowen", time.Hour)
	if err != nil {
		t.Fatalf("IssueToken: %v", err)
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("JWT segments = %d, want 3", len(parts))
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if bytes.IndexByte(payload, 0) >= 0 {
		t.Fatalf("JWT payload contains NUL: %q", payload)
	}
	if !json.Valid(payload) {
		t.Fatalf("JWT payload is invalid JSON: %q", payload)
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatalf("decode claims: %v", err)
	}
	if claims["username"] != "tianhaowen" || claims["sub"] != "tianhaowen" {
		t.Fatalf("unexpected identity claims: %#v", claims)
	}
	iat, iatOK := claims["iat"].(float64)
	exp, expOK := claims["exp"].(float64)
	if !iatOK || !expOK || exp <= iat {
		t.Fatalf("unexpected time claims: iat=%#v exp=%#v", claims["iat"], claims["exp"])
	}
}

func TestParseTokenRejectsBadSignature(t *testing.T) {
	tok, err := IssueToken("secret-a", "tianhaowen", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseToken("secret-b", tok); err == nil {
		t.Fatal("expected error for bad signature")
	}
}

func TestParseTokenRejectsExpired(t *testing.T) {
	tok, err := IssueToken("secret", "tianhaowen", -time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseToken("secret", tok); err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestRequireAdminJWT(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := "mw-secret"
	tok, err := IssueToken(secret, "tianhaowen", time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	r := gin.New()
	r.GET("/x", RequireAdminJWT(secret), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"user": c.GetString("admin_user")})
	})

	// 无 token → 401
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("no token: status %d, want 401", w.Code)
	}

	// 有效 token → 200
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("valid token: status %d, want 200", w.Code)
	}
}
