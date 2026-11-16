package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRegisterWebAppServesAssetsAndSpaFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<main>atolla</main>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(webDir, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(webDir, "assets", "app.js"), []byte("console.log('atolla')"), 0o600); err != nil {
		t.Fatal(err)
	}

	router := gin.New()
	registerWebApp(router, webDir)

	for _, testCase := range []struct {
		path  string
		body  string
		cache string
	}{
		{path: "/assets/app.js", body: "console.log('atolla')", cache: "public, max-age=31536000, immutable"},
		{path: "/agents/42", body: "<main>atolla</main>", cache: "no-cache"},
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, testCase.path, nil))
		if recorder.Code != http.StatusOK || recorder.Body.String() != testCase.body {
			t.Fatalf("GET %s = (%d, %q), want (200, %q)", testCase.path, recorder.Code, recorder.Body.String(), testCase.body)
		}
		if cacheControl := recorder.Header().Get("Cache-Control"); cacheControl != testCase.cache {
			t.Fatalf("GET %s Cache-Control = %q, want %q", testCase.path, cacheControl, testCase.cache)
		}
	}
}

func TestRegisterWebAppDoesNotFallbackForBackendPaths(t *testing.T) {
	gin.SetMode(gin.TestMode)
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<main>atolla</main>"), 0o600); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	registerWebApp(router, webDir)

	for _, requestPath := range []string{"/api/missing", "/internal/missing"} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, requestPath, nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("GET %s status = %d, want 404", requestPath, recorder.Code)
		}
	}
}
