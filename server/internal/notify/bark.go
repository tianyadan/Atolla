// Package notify 封装 Bark / ai-notify 推送(待授权提醒等)。
package notify

import (
	"errors"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

var (
	errNotifyUnavailable = errors.New("bark 未启用或脚本不可用")
	errNotifyDeduped     = errors.New("bark 已去重跳过")
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
	if err := n.enqueue(card, false); err != nil {
		return false
	}
	return true
}

// PushSync 同步推送 Bark（用于验证码等需立刻知道成败的场景）；仍按 DedupeKey 去重。
func (n *Notifier) PushSync(card Card) error {
	return n.enqueue(card, true)
}

// enqueue 组装参数并推送；sync=false 时后台执行。
func (n *Notifier) enqueue(card Card, sync bool) error {
	if n == nil || !n.enabled || n.bin == "" || card.DedupeKey == "" {
		return errNotifyUnavailable
	}
	n.mu.Lock()
	if _, ok := n.seen[card.DedupeKey]; ok {
		n.mu.Unlock()
		return errNotifyDeduped
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
	args := []string{title, body, icon, group, strings.TrimSpace(card.URL), strings.TrimSpace(card.Sound), strings.TrimSpace(card.Level)}
	if sync {
		return n.runner(bin, args...)
	}
	go func() {
		if err := n.runner(bin, args...); err != nil {
			log.Printf("bark notify failed: %v", err)
		}
	}()
	return nil
}

// PushCard 兼容旧调用；新代码应使用 Push 传递 Atolla 分组和深链。
func (n *Notifier) PushCard(dedupeKey, title, body, icon string) bool {
	return n.Push(Card{DedupeKey: dedupeKey, Title: title, Body: body, Icon: icon, Group: "Atolla"})
}

// PermissionOnce 兼容旧调用：正文由调用方传入，标题固定。
func (n *Notifier) PermissionOnce(requestID, message string) bool {
	return n.PushCard(requestID, "数字员工", message, "")
}
