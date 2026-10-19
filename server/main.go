package main

import (
	"log"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"atolla/server/config"
	"atolla/server/internal/auth"
	"atolla/server/internal/handler"
	"atolla/server/internal/service"
	"atolla/server/internal/store"
)

// routeCanaryPath 是只用于确认 POST 路由树还在的内部地址。
const routeCanaryPath = "/internal/route-canary"

// engineSlot 持有当前 Gin 引擎。POST 路由树损坏时可以整体换成一棵新树。
type engineSlot struct {
	mu  sync.RWMutex
	eng *gin.Engine
}

// ServeHTTP 把请求交给当前引擎。
func (s *engineSlot) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	eng := s.eng
	s.mu.RUnlock()
	eng.ServeHTTP(w, r)
}

// swap 替换当前引擎。进行中的请求仍走旧引擎。
func (s *engineSlot) swap(eng *gin.Engine) {
	s.mu.Lock()
	s.eng = eng
	s.mu.Unlock()
}

// postRoutesAlive 在进程内发一次 POST 自检，不占用监听端口。
func (s *engineSlot) postRoutesAlive() bool {
	s.mu.RLock()
	eng := s.eng
	s.mu.RUnlock()
	if eng == nil {
		return false
	}
	rec := httptest.NewRecorder()
	eng.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, routeCanaryPath, nil))
	return rec.Code == http.StatusNoContent
}

// newEngine 组装一套新的路由。POST 方法树损坏后用它换掉旧引擎。
func newEngine(cfg config.Config, h *handler.Handler) *gin.Engine {
	r := gin.New()
	r.Use(gin.LoggerWithConfig(gin.LoggerConfig{
		SkipPaths: []string{routeCanaryPath},
	}), gin.Recovery())
	if len(cfg.AllowedIPs) > 0 {
		r.Use(auth.GinIPAllowlist(cfg.AllowedIPs))
	}
	h.Register(r)
	return r
}

// watchPostRoutes 周期性自检 POST 路由。发现整组 404 时重建路由树。
func watchPostRoutes(slot *engineSlot, cfg config.Config, h *handler.Handler) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if slot.postRoutesAlive() {
			continue
		}
		log.Printf("POST routes missing, rebuilding router")
		slot.swap(newEngine(cfg, h))
	}
}

func main() {
	cfg := config.Load()

	st, err := store.New(cfg.DBDSN)
	if err != nil {
		log.Fatalf("connect mysql: %v", err)
	}

	svc := service.New(cfg, st)
	defer svc.Shutdown()
	h := handler.New(svc)

	slot := &engineSlot{}
	slot.swap(newEngine(cfg, h))
	go watchPostRoutes(slot, cfg, h)

	log.Printf("atolla listening on %s", cfg.Addr)
	srv := &http.Server{Addr: cfg.Addr, Handler: slot}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		svc.Perms.CloseAll()
		svc.Sched.Stop()
		log.Fatal(err)
	}
	svc.Perms.CloseAll()
	svc.Sched.Stop()
}
