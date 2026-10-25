package service

import (
	"fmt"
	"strings"

	"atolla/server/internal/store"
)

// BuildAgentSystemPrompt 拼系统提示 + 权限策略硬约束。
func BuildAgentSystemPrompt(a *store.ManagedAgent) string {
	base := strings.TrimSpace(a.RulesPrompt)
	if base == "" {
		base = "你是数字员工「" + a.Name + "」,按用户指令完成开发/排查任务。回答简洁专业。"
	}
	return base + "\n\n" + AgentPolicyBlock(a) + "\n\n" + ProjectMemoryHint()
}

// AgentPolicyBlock 权限策略条文(始终注入)。
func AgentPolicyBlock(a *store.ManagedAgent) string {
	var b strings.Builder
	b.WriteString("【数字员工权限策略 — 必须遵守】\n")
	if a.AllowWrite {
		b.WriteString("- 写入权限:允许修改/创建文件（Hard Deny / rm / 越界仍拦截）。\n")
	} else {
		b.WriteString("- 写入权限:禁止。不得创建/修改/删除文件,不得重定向写入。\n")
	}
	if a.AllowNetwork {
		b.WriteString("- 联网权限:允许访问外网/搜索(仍可能需授权)。\n")
	} else {
		b.WriteString("- 联网权限:禁止。不得 curl/wget/WebFetch/WebSearch 等外网访问。\n")
	}
	if a.AllowRm {
		b.WriteString("- rm 权限:允许执行 rm(仍可能需授权)。\n")
	} else {
		b.WriteString("- rm 权限:禁止。不得执行任何 rm/unlink 删除命令。\n")
	}
	if a.AllowBrowser {
		b.WriteString("- 浏览器权限:允许（技能 atolla.browser）。可使用 browser-use 操作浏览器完成网页交互、点击、填表、抓取等。\n")
		b.WriteString("  前提:本机已安装 browser-use；操作时说明步骤，注意勿泄露凭据。\n")
		b.WriteString("  硬性要求:用完必须关闭标签/窗口，禁止留下僵尸页；任务结束前确认无残留浏览器会话。\n")
	} else {
		b.WriteString("- 浏览器权限:禁止。未安装「浏览器操作」技能时，不得调用 browser-use / 浏览器自动化工具。\n")
	}
	ws := strings.TrimSpace(a.WorkspacePath)
	if ws == "" {
		// 未勾选「限制工作区」：不按目录边界拦截，默认可全盘读写（仍受写入/联网/rm 开关与 Hard Deny 约束）
		b.WriteString("- 工作区:未限制。默认可在本机任意路径读写（仍受上方写入/联网/rm 开关约束；Hard Deny 仍拦截）。\n")
	} else {
		b.WriteString("- 工作区:已绑定「" + ws + "」。严禁读写该目录之外的任何路径。\n")
	}
	b.WriteString("违规操作会被系统直接拒绝。")
	return b.String()
}

// MaybeReinforcePolicy 每 10 轮用户消息附加策略重申。
func MaybeReinforcePolicy(a *store.ManagedAgent, userTurnCount int, question string) string {
	if userTurnCount > 0 && userTurnCount%10 == 0 {
		return "【策略重申 — 第" + fmt.Sprintf("%d", userTurnCount) + "轮】\n" + AgentPolicyBlock(a) + "\n\n" + question
	}
	return question
}
