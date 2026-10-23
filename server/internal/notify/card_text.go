package notify

import (
	"fmt"
	"strings"
)

const AtollaGroup = "Atolla"

// TaskTitle 把用户原话收成不超过 10 个字的任务标题。
func TaskTitle(question string) string {
	s := oneLine(question, 0)
	for _, p := range []string{"请你帮我", "请帮我", "帮我把", "帮我", "请你", "麻烦你", "麻烦", "请"} {
		if strings.HasPrefix(s, p) {
			s = strings.TrimSpace(strings.TrimPrefix(s, p))
			break
		}
	}
	for _, sep := range []string{"。", "！", "？", "；", "\n"} {
		if i := strings.Index(s, sep); i >= 0 {
			s = strings.TrimSpace(s[:i])
			break
		}
	}
	r := []rune(strings.TrimSpace(s))
	if len(r) == 0 {
		return "未命名任务"
	}
	if len(r) > 10 {
		r = r[:10]
	}
	return string(r)
}

// TaskDoneText 完成通知正文：任务 + 10字内标题 + 任务已完成。
func TaskDoneText(question string) string {
	return "任务" + TaskTitle(question) + " 任务已完成"
}

// TaskDoneCard 生成可一眼识别应用、员工和耗时的完成通知。
func TaskDoneCard(agentName, department, question string, durationMS int) Card {
	return Card{
		Title: "✅ Atolla · 任务完成",
		Body:  actorLine(agentName, department) + "\n" + TaskTitle(question) + " · 用时 " + formatDuration(durationMS),
		Group: AtollaGroup,
		Sound: "bell",
		Level: "active",
	}
}

// PermissionCard 生成待审批通知；命令摘要只保留一行，避免锁屏卡片被长 JSON 占满。
func PermissionCard(agentName, department, summary, risk string) Card {
	command := oneLine(summary, 64)
	if command == "" {
		command = "有一条命令等待审批"
	}
	return Card{
		Title: "⚠️ Atolla · 命令待审批",
		Body:  actorLine(agentName, department) + "\n待审批：" + command + "\n风险：" + riskLabel(risk),
		Group: AtollaGroup,
		Sound: "alarm",
		Level: "timeSensitive",
	}
}

func actorLine(agentName, department string) string {
	name := strings.TrimSpace(agentName)
	if name == "" {
		name = "数字员工"
	}
	group := strings.TrimSpace(department)
	if group == "" {
		group = "未分组"
	}
	return name + "｜" + group
}

func riskLabel(risk string) string {
	switch strings.ToLower(strings.TrimSpace(risk)) {
	case "low":
		return "低风险"
	case "high":
		return "高风险"
	default:
		return "需注意"
	}
}

func formatDuration(ms int) string {
	if ms <= 0 {
		return "不足1秒"
	}
	seconds := (ms + 500) / 1000
	if seconds < 60 {
		return fmt.Sprintf("%d秒", seconds)
	}
	minutes := seconds / 60
	remain := seconds % 60
	if remain == 0 {
		return fmt.Sprintf("%d分钟", minutes)
	}
	return fmt.Sprintf("%d分%d秒", minutes, remain)
}

func oneLine(s string, max int) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\r\n", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if max > 0 && len(r) > max {
		return string(r[:max]) + "…"
	}
	return s
}
