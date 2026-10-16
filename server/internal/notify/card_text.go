package notify

import "strings"

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
