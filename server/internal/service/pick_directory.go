package service

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// PickDirectoryResult 本机目录选择结果。
type PickDirectoryResult struct {
	Path      string `json:"path"`
	Cancelled bool   `json:"cancelled,omitempty"`
	OS        string `json:"os"`
}

// PickDirectory 弹出本机原生「选择文件夹」对话框（macOS 用系统面板）。
// 非 darwin 返回明确错误，前端可回退到手输路径。
func (s *Service) PickDirectory(ctx context.Context, prompt string) (*PickDirectoryResult, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		prompt = "选择数字员工工作区目录"
	}
	out := &PickDirectoryResult{OS: runtime.GOOS}
	if runtime.GOOS != "darwin" {
		return out, fmt.Errorf("当前系统不支持原生选目录，请手动输入绝对路径")
	}
	// 给用户足够时间在 Finder 面板里操作
	cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	script := fmt.Sprintf(`try
  set theFolder to choose folder with prompt %q
  return POSIX path of theFolder
on error number -128
  return "__CANCELLED__"
end try`, prompt)

	cmd := exec.CommandContext(cctx, "osascript", "-e", script)
	raw, err := cmd.Output()
	if err != nil {
		if cctx.Err() != nil {
			return out, fmt.Errorf("选择目录超时或已取消")
		}
		return out, fmt.Errorf("无法打开系统选目录面板: %w", err)
	}
	path := strings.TrimSpace(string(raw))
	path = strings.TrimRight(path, "/")
	if path == "" || path == "__CANCELLED__" {
		out.Cancelled = true
		return out, nil
	}
	out.Path = path
	return out, nil
}

// PickSQLiteFile 弹出本机原生「选择/保存 .db 文件」对话框（macOS）。
// mode: "open" 选已有文件；"save" 指定新文件路径。
func (s *Service) PickSQLiteFile(ctx context.Context, prompt, mode string) (*PickDirectoryResult, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "" {
		mode = "open"
	}
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		if mode == "save" {
			prompt = "选择 SQLite 数据库保存位置"
		} else {
			prompt = "选择 SQLite 数据库文件"
		}
	}
	out := &PickDirectoryResult{OS: runtime.GOOS}
	if runtime.GOOS != "darwin" {
		return out, fmt.Errorf("当前系统不支持原生选文件，请手动输入绝对路径")
	}
	cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	var script string
	if mode == "save" {
		script = fmt.Sprintf(`try
  set theFile to choose file name with prompt %q default name "atolla.db"
  return POSIX path of theFile
on error number -128
  return "__CANCELLED__"
end try`, prompt)
	} else {
		script = fmt.Sprintf(`try
  set theFile to choose file with prompt %q of type {"db", "sqlite", "public.data"}
  return POSIX path of theFile
on error number -128
  return "__CANCELLED__"
end try`, prompt)
	}
	cmd := exec.CommandContext(cctx, "osascript", "-e", script)
	raw, err := cmd.Output()
	if err != nil {
		if cctx.Err() != nil {
			return out, fmt.Errorf("选择文件超时或已取消")
		}
		return out, fmt.Errorf("无法打开系统选文件面板: %w", err)
	}
	path := strings.TrimSpace(string(raw))
	if path == "" || path == "__CANCELLED__" {
		out.Cancelled = true
		return out, nil
	}
	// choose file name 可能不带 .db
	if !strings.HasSuffix(strings.ToLower(path), ".db") {
		path += ".db"
	}
	out.Path = path
	return out, nil
}
