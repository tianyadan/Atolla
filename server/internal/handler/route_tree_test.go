package handler

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"unsafe"

	"github.com/gin-gonic/gin"
)

// indexMem 是某条路由索引字符串当前的底层内存。
type indexMem struct {
	ptr unsafe.Pointer
	n   int
}

func (m indexMem) smash() {
	if m.ptr == nil || m.n <= 0 {
		return
	}
	buf := unsafe.Slice((*byte)(m.ptr), m.n)
	for i := range buf {
		buf[i] = 'X'
	}
}

// TestRouteIndexBytesAreLive 覆盖 indices 当前指向的字节后，POST 应匹配失败。
// 用来证明 Gin 查找确实依赖这块内存，而不是只读一份拷贝。
func TestRouteIndexBytesAreLive(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/auth/login", func(c *gin.Context) { c.Status(http.StatusCreated) })
	r.POST("/api/admin/agents/:id/ask", func(c *gin.Context) { c.Status(http.StatusAccepted) })
	r.GET("/health", func(c *gin.Context) { c.Status(http.StatusOK) })

	for _, mem := range routeIndexPointers(r) {
		mem.smash()
	}
	ask := httptest.NewRecorder()
	r.ServeHTTP(ask, httptest.NewRequest(http.MethodPost, "/api/admin/agents/28/ask", nil))
	if ask.Code != http.StatusNotFound {
		t.Fatalf("corrupted POST ask = %d, want 404", ask.Code)
	}
}

// TestStabilizeRouteTreeSurvivesIndexOverwrite 确认复制后的路由索引不再指向临时内存。
func TestStabilizeRouteTreeSurvivesIndexOverwrite(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/auth/login", func(c *gin.Context) { c.Status(http.StatusCreated) })
	r.POST("/api/admin/agents/:id/ask", func(c *gin.Context) { c.Status(http.StatusAccepted) })
	r.POST("/api/admin/agents/pc-viewer", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	r.GET("/health", func(c *gin.Context) { c.Status(http.StatusOK) })

	before := routeIndexPointers(r)
	if len(before) == 0 {
		t.Fatal("expected route index bytes")
	}
	stabilizeRouteTree(r)
	for _, mem := range before {
		mem.smash()
	}

	ask := httptest.NewRecorder()
	r.ServeHTTP(ask, httptest.NewRequest(http.MethodPost, "/api/admin/agents/28/ask", nil))
	if ask.Code != http.StatusAccepted {
		t.Fatalf("POST ask = %d, want 202", ask.Code)
	}
	health := httptest.NewRecorder()
	r.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/health", nil))
	if health.Code != http.StatusOK {
		t.Fatalf("GET health = %d, want 200", health.Code)
	}
}

// routeIndexPointers 取出路由树上 indices 字符串当前指向的字节。
func routeIndexPointers(engine *gin.Engine) []indexMem {
	var out []indexMem
	trees := reflect.ValueOf(engine).Elem().FieldByName("trees")
	for i := 0; i < trees.Len(); i++ {
		root := trees.Index(i).FieldByName("root")
		if root.Kind() == reflect.Pointer && !root.IsNil() {
			collectIndexPointers(root, &out)
		}
	}
	return out
}

func collectIndexPointers(node reflect.Value, out *[]indexMem) {
	elem := node.Elem()
	indices := elem.FieldByName("indices")
	if indices.IsValid() && indices.Kind() == reflect.String && indices.Len() > 0 {
		s := indices.String()
		*out = append(*out, indexMem{ptr: unsafe.Pointer(unsafe.StringData(s)), n: len(s)})
	}
	children := elem.FieldByName("children")
	for i := 0; i < children.Len(); i++ {
		child := children.Index(i)
		if child.Kind() == reflect.Pointer && !child.IsNil() {
			collectIndexPointers(child, out)
		}
	}
}
