package service

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// BrowserUseStatus describes local browser-use availability.
type BrowserUseStatus struct {
	OK      bool   `json:"ok"`
	Bin     string `json:"bin,omitempty"`
	Version string `json:"version,omitempty"`
	Source  string `json:"source,omitempty"` // path | installed
	Message string `json:"message,omitempty"`
}

var (
	browserUseCacheMu sync.Mutex
	browserUseCache   *BrowserUseStatus
)

// DetectBrowserUse checks PATH for the browser-use CLI.
func DetectBrowserUse() BrowserUseStatus {
	browserUseCacheMu.Lock()
	if browserUseCache != nil {
		st := *browserUseCache
		browserUseCacheMu.Unlock()
		return st
	}
	browserUseCacheMu.Unlock()

	st := probeBrowserUse()
	browserUseCacheMu.Lock()
	browserUseCache = &st
	browserUseCacheMu.Unlock()
	return st
}

func invalidateBrowserUseCache() {
	browserUseCacheMu.Lock()
	browserUseCache = nil
	browserUseCacheMu.Unlock()
}

func probeBrowserUse() BrowserUseStatus {
	path, err := exec.LookPath("browser-use")
	if err != nil {
		return BrowserUseStatus{OK: false, Message: "未找到 browser-use 命令"}
	}
	st := BrowserUseStatus{OK: true, Bin: path, Source: "path"}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--version")
	out, err := cmd.CombinedOutput()
	if err == nil {
		st.Version = strings.TrimSpace(string(out))
	}
	return st
}

// EnsureBrowserUse detects browser-use; if missing, tries to install it.
func (s *Service) EnsureBrowserUse(ctx context.Context) (BrowserUseStatus, error) {
	invalidateBrowserUseCache()
	st := DetectBrowserUse()
	if st.OK {
		st.Message = "已安装"
		return st, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	var lastErr error
	for _, step := range browserUseInstallSteps() {
		if err := step.run(ctx); err != nil {
			lastErr = fmt.Errorf("%s: %w", step.name, err)
			continue
		}
		invalidateBrowserUseCache()
		st = DetectBrowserUse()
		if st.OK {
			st.Source = "installed"
			st.Message = "已自动安装 (" + step.name + ")"
			return st, nil
		}
	}
	msg := "自动安装失败"
	if lastErr != nil {
		msg = msg + ": " + lastErr.Error()
	}
	return BrowserUseStatus{OK: false, Message: msg}, fmt.Errorf("%s", msg)
}

type installStep struct {
	name string
	run  func(context.Context) error
}

func browserUseInstallSteps() []installStep {
	return []installStep{
		{name: "uv tool install", run: func(ctx context.Context) error {
			uv, err := exec.LookPath("uv")
			if err != nil {
				return fmt.Errorf("uv not found")
			}
			return runCmd(ctx, 3*time.Minute, uv, "tool", "install", "browser-use")
		}},
		{name: "pipx install", run: func(ctx context.Context) error {
			pipx, err := exec.LookPath("pipx")
			if err != nil {
				return fmt.Errorf("pipx not found")
			}
			return runCmd(ctx, 3*time.Minute, pipx, "install", "browser-use")
		}},
		{name: "claude plugin", run: func(ctx context.Context) error {
			claude, err := exec.LookPath("claude")
			if err != nil {
				return fmt.Errorf("claude not found")
			}
			// marketplace add 失败可忽略（可能已添加）
			_ = runCmd(ctx, 2*time.Minute, claude, "plugin", "marketplace", "add", "browser-use/plugins")
			return runCmd(ctx, 3*time.Minute, claude, "plugin", "install", "browser-use@browser-use")
		}},
	}
}

func runCmd(ctx context.Context, timeout time.Duration, bin string, args ...string) error {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, bin, args...)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	if err := cmd.Run(); err != nil {
		out := strings.TrimSpace(buf.String())
		if out != "" {
			return fmt.Errorf("%w: %s", err, truncateRunOut(out, 400))
		}
		return err
	}
	return nil
}

func truncateRunOut(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// ListBrowserUseStatus is the admin API helper.
func (s *Service) ListBrowserUseStatus() BrowserUseStatus {
	st := DetectBrowserUse()
	if st.OK && st.Message == "" {
		st.Message = "已安装"
	}
	return st
}
