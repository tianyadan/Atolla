// Package notify 封装 Bark / ai-notify 推送(待授权提醒等)。
package notify

import (
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// PermissionPendingText 待审批固定文案。
const PermissionPendingText = "有一条命令待审批"

// Notifier 异步调用本机通知脚本;按 request_id 去重。
type Notifier struct {
	bin     string
	enabled bool
	mu      sync.Mutex
	seen    map[string]time.Time
	runner  func(name string, args ...string) error // 可注入测试
}

// New 创建通知器。bin 为空或 enabled=false 时 PermissionOnce 直接跳过。
func New(bin string, enabled bool) *Notifier {
	if bin == "" {
		enabled = false
	}
	return &Notifier{
		bin:     bin,
		enabled: enabled,
		seen:    map[string]time.Time{},
		runner: func(name string, args ...string) error {
			cmd := exec.Command(name, args...)
			cmd.Env = os.Environ()
			out, err := cmd.CombinedOutput()
			if err != nil {
				log.Printf("notify script output: %s", string(out))
				return err
			}
			return nil
		},
	}
}

// PushCard 推一条 Bark 卡片（标题、正文、头像 URL）。同一 dedupeKey 只发一次。
func (n *Notifier) PushCard(dedupeKey, title, body, icon string) bool {
	if n == nil || !n.enabled || n.bin == "" || dedupeKey == "" {
		return false
	}
	n.mu.Lock()
	if _, ok := n.seen[dedupeKey]; ok {
		n.mu.Unlock()
		return false
	}
	n.seen[dedupeKey] = time.Now()
	if len(n.seen) > 500 {
		n.seen = map[string]time.Time{dedupeKey: time.Now()}
	}
	n.mu.Unlock()

	title = strings.TrimSpace(title)
	if title == "" {
		title = "数字员工"
	}
	body = strings.TrimSpace(body)
	if body == "" {
		body = PermissionPendingText
	}
	icon = strings.TrimSpace(icon)
	bin := n.bin
	go func() {
		if err := n.runner(bin, title, body, icon); err != nil {
			log.Printf("bark notify failed: %v", err)
		}
	}()
	return true
}

// PermissionOnce 兼容旧调用：正文由调用方传入，标题固定。
func (n *Notifier) PermissionOnce(requestID, message string) bool {
	return n.PushCard(requestID, "数字员工", message, "")
}
