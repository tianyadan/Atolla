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

// Card 是一条完整 Bark 通知；DedupeKey 仅用于进程内去重，不会发送给 Bark。
type Card struct {
	DedupeKey string
	Title     string
	Body      string
	Icon      string
	Group     string
	URL       string
	Sound     string
	Level     string
}

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

// Push 推送完整 Bark 卡片。同一 DedupeKey 只发一次。
func (n *Notifier) Push(card Card) bool {
	if n == nil || !n.enabled || n.bin == "" || card.DedupeKey == "" {
		return false
	}
	n.mu.Lock()
	if _, ok := n.seen[card.DedupeKey]; ok {
		n.mu.Unlock()
		return false
	}
	n.seen[card.DedupeKey] = time.Now()
	if len(n.seen) > 500 {
		n.seen = map[string]time.Time{card.DedupeKey: time.Now()}
	}
	n.mu.Unlock()

	title := strings.TrimSpace(card.Title)
	if title == "" {
		title = "Atolla"
	}
	body := strings.TrimSpace(card.Body)
	if body == "" {
		body = PermissionPendingText
	}
	icon := strings.TrimSpace(card.Icon)
	group := strings.TrimSpace(card.Group)
	if group == "" {
		group = "Atolla"
	}
	bin := n.bin
	go func() {
		if err := n.runner(bin, title, body, icon, group, strings.TrimSpace(card.URL), strings.TrimSpace(card.Sound), strings.TrimSpace(card.Level)); err != nil {
			log.Printf("bark notify failed: %v", err)
		}
	}()
	return true
}

// PushCard 兼容旧调用；新代码应使用 Push 传递 Atolla 分组和深链。
func (n *Notifier) PushCard(dedupeKey, title, body, icon string) bool {
	return n.Push(Card{DedupeKey: dedupeKey, Title: title, Body: body, Icon: icon, Group: "Atolla"})
}

// PermissionOnce 兼容旧调用：正文由调用方传入，标题固定。
func (n *Notifier) PermissionOnce(requestID, message string) bool {
	return n.PushCard(requestID, "数字员工", message, "")
}
