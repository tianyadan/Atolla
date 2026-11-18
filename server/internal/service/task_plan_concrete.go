package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"atolla/server/internal/store"
)

var vagueStepRe = regexp.MustCompile(`(?i)(正在规划|正在执行|正在输出|规划中|\b执行中\b|输出结果|处理中|开始任务|整理并回复|理解需求与目标|执行任务)`)

// PlanConcreteStepDetails 产出 3～8 条具体步骤（title≤6 rune + detail），供确认弹窗。
func (s *Service) PlanConcreteStepDetails(ctx context.Context, a *store.ManagedAgent, question string, callees []AgentRef, onEvent AskEventSink) []TaskPlanStep {
	q := strings.TrimSpace(question)
	if q == "" {
		q = "完成用户下达的任务"
	}
	var raw []TaskPlanStep
	if a != nil {
		pctx, cancel := context.WithTimeout(ctx, 45*time.Second)
		raw = s.planStepsDetailedViaEngine(pctx, a, q, callees, onEvent)
		cancel()
	}
	out := filterConcreteStepDetails(raw)
	if len(out) >= TaskPlanMinSteps {
		if len(out) > TaskPlanMaxSteps {
			out = out[:TaskPlanMaxSteps]
		}
		return out
	}
	return heuristicPlanStepDetails(q, callees)
}

// PlanConcreteSteps 兼容旧调用：只返回标题列表。
func (s *Service) PlanConcreteSteps(ctx context.Context, a *store.ManagedAgent, question string, callees []AgentRef, onEvent AskEventSink) []string {
	steps := s.PlanConcreteStepDetails(ctx, a, question, callees, onEvent)
	out := make([]string, 0, len(steps))
	for _, st := range steps {
		out = append(out, st.Title)
	}
	return out
}

func filterConcreteStepDetails(steps []TaskPlanStep) []TaskPlanStep {
	var out []TaskPlanStep
	seen := map[string]bool{}
	for i, st := range steps {
		title := clampPlanTitle(strings.TrimSpace(st.Title))
		title = strings.TrimLeft(title, "0123456789.、)） ")
		if title == "" || vagueStepRe.MatchString(title) {
			continue
		}
		if utf8.RuneCountInString(title) < 2 {
			continue
		}
		key := strings.ToLower(title)
		if seen[key] {
			continue
		}
		seen[key] = true
		id := strings.TrimSpace(st.ID)
		if id == "" {
			id = fmt.Sprintf("s%d", i)
		}
		out = append(out, TaskPlanStep{
			ID:     id,
			Title:  title,
			Detail: strings.TrimSpace(st.Detail),
			Status: TaskStepPending,
		})
	}
	return out
}

func heuristicPlanStepDetails(question string, callees []AgentRef) []TaskPlanStep {
	titles := HeuristicPlanSteps(question, callees)
	out := make([]TaskPlanStep, 0, len(titles))
	for i, t := range titles {
		out = append(out, TaskPlanStep{
			ID:     fmt.Sprintf("s%d", i),
			Title:  clampPlanTitle(t),
			Detail: t,
			Status: TaskStepPending,
		})
	}
	return filterConcreteStepDetails(out)
}

func filterConcreteSteps(steps []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, s := range steps {
		s = strings.TrimSpace(s)
		s = strings.TrimLeft(s, "0123456789.、)） ")
		if s == "" || vagueStepRe.MatchString(s) {
			continue
		}
		if utf8.RuneCountInString(s) < 4 {
			continue
		}
		key := strings.ToLower(s)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, s)
	}
	return out
}

// HeuristicPlanSteps 无模型/拆分失败时的具体兜底(保证 ≥4 且无空话)。
func HeuristicPlanSteps(question string, callees []AgentRef) []string {
	q := strings.TrimSpace(question)
	steps := []string{"确认任务目标：" + truncateRunes(q, 36)}
	for _, p := range splitTaskHints(q) {
		steps = append(steps, "落实："+p)
		if len(steps) >= 5 {
			break
		}
	}
	if len(steps) < 3 {
		steps = append(steps,
			"收集与任务相关的代码、配置或日志线索",
			"按目标完成核心查询或改动",
		)
	}
	for _, c := range callees {
		name := c.Name
		if name == "" {
			name = fmt.Sprintf("#%d", c.ID)
		}
		steps = append(steps, "整合「"+name+"」返回的专项结果")
	}
	if len(callees) > 0 {
		steps = append(steps, "汇总各位同事产出并给出明确结论")
	} else {
		steps = append(steps, "核对结果是否满足要求后回复用户")
	}
	out := filterConcreteSteps(steps)
	if len(out) < 4 {
		out = append(out,
			"列出需要触达的文件或接口清单",
			"逐项完成清单中的关键动作",
			"记录关键输出与异常",
			"向用户汇报结论与下一步建议",
		)
		out = filterConcreteSteps(out)
	}
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

func splitTaskHints(q string) []string {
	q = strings.ReplaceAll(q, "\n", "。")
	seps := regexp.MustCompile(`[。；;！!？?]+`)
	raw := seps.Split(q, -1)
	var out []string
	for _, r := range raw {
		r = strings.TrimSpace(r)
		r = strings.TrimLeft(r, "-*•、 ")
		if utf8.RuneCountInString(r) < 6 {
			continue
		}
		out = append(out, truncateRunes(r, 48))
		if len(out) >= 5 {
			break
		}
	}
	return out
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func parseStepsJSON(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	i := strings.Index(raw, "[")
	j := strings.LastIndex(raw, "]")
	if i >= 0 && j > i {
		raw = raw[i : j+1]
	}
	var arr []string
	if err := json.Unmarshal([]byte(raw), &arr); err == nil {
		return arr
	}
	var objs []map[string]string
	if err := json.Unmarshal([]byte(raw), &objs); err == nil {
		for _, o := range objs {
			if o["step"] != "" {
				arr = append(arr, o["step"])
			} else if o["title"] != "" {
				arr = append(arr, o["title"])
			}
		}
	}
	return arr
}

func parseStepDetailsJSON(raw string) []TaskPlanStep {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	i := strings.Index(raw, "[")
	j := strings.LastIndex(raw, "]")
	if i >= 0 && j > i {
		raw = raw[i : j+1]
	}
	var objs []map[string]any
	if err := json.Unmarshal([]byte(raw), &objs); err == nil {
		var out []TaskPlanStep
		for idx, o := range objs {
			title, _ := o["title"].(string)
			if title == "" {
				title, _ = o["step"].(string)
			}
			detail, _ := o["detail"].(string)
			if detail == "" {
				detail, _ = o["desc"].(string)
			}
			id, _ := o["id"].(string)
			if id == "" {
				id = fmt.Sprintf("s%d", idx)
			}
			if strings.TrimSpace(title) == "" {
				continue
			}
			out = append(out, TaskPlanStep{ID: id, Title: title, Detail: detail, Status: TaskStepPending})
		}
		if len(out) > 0 {
			return out
		}
	}
	// 兼容纯字符串数组
	titles := parseStepsJSON(raw)
	out := make([]TaskPlanStep, 0, len(titles))
	for idx, t := range titles {
		out = append(out, TaskPlanStep{ID: fmt.Sprintf("s%d", idx), Title: t, Detail: t, Status: TaskStepPending})
	}
	return out
}

func (s *Service) planStepsDetailedViaEngine(ctx context.Context, a *store.ManagedAgent, question string, callees []AgentRef, onEvent AskEventSink) []TaskPlanStep {
	var b strings.Builder
	b.WriteString("把下面任务拆成 3～6 个里程碑步骤（不要拆成细碎操作）。\n")
	b.WriteString("每步包含：title（不超过6个字，短标签）、detail（一两句说明要做什么）。\n")
	b.WriteString("禁止「正在规划/正在执行/理解需求」等空话。\n")
	b.WriteString("只输出 JSON 数组，例如 [{\"title\":\"查现状\",\"detail\":\"阅读相关模块确认入口\"},...]。\n")
	if len(callees) > 0 {
		b.WriteString("其中会协作其他同事：")
		for i, c := range callees {
			if i > 0 {
				b.WriteString("、")
			}
			b.WriteString(c.Name)
		}
		b.WriteString("。\n")
	}
	b.WriteString("任务：\n")
	b.WriteString(question)

	sys := "你是任务拆分助手,只输出 JSON 数组。"
	out, _, err := s.runManagedEngine(ctx, a, sys, b.String(), "", nil, nil, 0, 0, 0, true, onEvent, nil)
	if err != nil {
		return nil
	}
	return parseStepDetailsJSON(out)
}
