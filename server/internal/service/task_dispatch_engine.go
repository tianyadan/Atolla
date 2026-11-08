package service

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"

	"atolla/server/internal/store"
)

// DispatchTaskRequest 是调度引擎的通用输入；显式元数据始终优先于文本推断。
type DispatchTaskRequest struct {
	Title                string
	Body                 string
	Labels               []string
	TaskType             string
	RequiredRole         string
	RequiredCapabilities []string
	OptionalTags         []string
	RequiredPermissions  []string
	ExplicitAgentID      int64
	AllowedAgentIDs      []int64 // 可选候选白名单，例如插件设置中勾选的员工
	EnforceAllowedAgents bool    // true 时空白名单也表示没有授权候选
}

// DispatchClassification 是规则或 LLM 生成的结构化分类，不包含执行者选择。
type DispatchClassification struct {
	TaskType             string   `json:"task_type"`
	RequiredRole         string   `json:"required_role"`
	RequiredCapabilities []string `json:"required_capabilities"`
	OptionalTags         []string `json:"optional_tags"`
	RequiredPermissions  []string `json:"required_permissions"`
	Confidence           float64  `json:"confidence"`
	Source               string   `json:"source"` // explicit | rules | llm | manual
	Reasons              []string `json:"reasons"`
	LLMUsed              bool     `json:"llm_used"`
	NeedsManual          bool     `json:"needs_manual"`
	FallbackError        string   `json:"fallback_error,omitempty"`
}

// DispatchClassificationFallback 只负责分类，禁止返回或决定 Agent。
// 生产环境可在该边界接入任意 LLM；失败时引擎会降级为人工分类。
type DispatchClassificationFallback interface {
	ClassifyDispatchTask(context.Context, DispatchTaskRequest) (DispatchClassification, error)
}

// DispatchAgentProfile 是硬约束和评分所需的最小 Agent 快照。
type DispatchAgentProfile struct {
	ID           int64
	Name         string
	JobRole      string
	Status       string
	AcceptsTasks bool
	Capabilities []string
	Tags         []string
	Permissions  map[string]bool
	ActiveTasks  int
	MaxActive    int
	Occupied     bool
}

type DispatchCandidate struct {
	AgentID       int64    `json:"agent_id"`
	AgentName     string   `json:"agent_name"`
	Score         float64  `json:"score"`
	ActiveTasks   int      `json:"active_tasks"`
	Occupied      bool     `json:"occupied"`
	MatchedTags   []string `json:"matched_tags"`
	Reasons       []string `json:"reasons"`
	StableSortKey string   `json:"stable_sort_key"`
}

type DispatchRejection struct {
	AgentID   int64    `json:"agent_id"`
	AgentName string   `json:"agent_name"`
	Reasons   []string `json:"reasons"`
}

type DispatchRecommendation struct {
	Classification DispatchClassification `json:"classification"`
	Recommended    *DispatchCandidate     `json:"recommended,omitempty"`
	Alternatives   []DispatchCandidate    `json:"alternatives"`
	Rejected       []DispatchRejection    `json:"rejected"`
	NeedsManual    bool                   `json:"needs_manual"`
	Reason         string                 `json:"reason,omitempty"`
}

type dispatchRule struct {
	taskType string
	role     string
	aliases  []string
	keywords []string
}

var dispatchRules = []dispatchRule{
	{taskType: "frontend", role: "前端", aliases: []string{"frontend", "前端"}, keywords: []string{"前端", "react", "vue", "css", "页面", "界面"}},
	{taskType: "backend", role: "后端", aliases: []string{"backend", "后端"}, keywords: []string{"后端", "接口", "api", "数据库", "golang", "go ", "java", "服务端"}},
	{taskType: "test", role: "测试", aliases: []string{"test", "testing", "qa", "测试"}, keywords: []string{"测试", "回归", "验收", "用例", "qa"}},
	{taskType: "ops", role: "运维", aliases: []string{"ops", "devops", "运维"}, keywords: []string{"运维", "部署", "发布", "服务器", "docker", "kubernetes", "监控"}},
	{taskType: "design", role: "设计", aliases: []string{"design", "ui", "ux", "设计"}, keywords: []string{"设计", "视觉", "交互", "ui", "ux"}},
	{taskType: "docs", role: "文档", aliases: []string{"docs", "documentation", "文档"}, keywords: []string{"文档", "readme", "说明书", "使用说明"}},
	{taskType: "mobile", role: "移动端", aliases: []string{"mobile", "ios", "android", "移动端"}, keywords: []string{"ios", "iphone", "android", "移动端", "手机端"}},
}

// ClassifyDispatchTask 先使用显式字段和稳定规则；无法归类时才调用 LLM 兜底。
func ClassifyDispatchTask(ctx context.Context, req DispatchTaskRequest, fallback DispatchClassificationFallback) DispatchClassification {
	out := DispatchClassification{
		TaskType:             normalizeDispatchValue(req.TaskType),
		RequiredRole:         strings.TrimSpace(req.RequiredRole),
		RequiredCapabilities: normalizeDispatchList(req.RequiredCapabilities),
		OptionalTags:         normalizeDispatchList(req.OptionalTags),
		RequiredPermissions:  normalizeDispatchPermissions(req.RequiredPermissions),
	}
	parseDispatchLabels(req.Labels, &out)
	if out.TaskType != "" || out.RequiredRole != "" {
		fillDispatchType(&out)
		out.Source = "explicit"
		out.Confidence = 1
		out.Reasons = append(out.Reasons, "使用任务显式元数据")
		fillDispatchRole(&out)
		if out.RequiredRole == "" && len(out.RequiredCapabilities) == 0 && len(out.RequiredPermissions) == 0 {
			out.Source = "manual"
			out.NeedsManual = true
			out.Reasons = append(out.Reasons, "任务类型没有可执行的岗位、能力或权限约束")
		}
		return out
	}

	text := strings.ToLower(strings.TrimSpace(req.Title + "\n" + req.Body))
	for _, rule := range dispatchRules {
		if containsDispatchKeyword(text, rule.keywords) {
			out.TaskType = rule.taskType
			if out.RequiredRole == "" {
				out.RequiredRole = rule.role
			}
			out.Source = "rules"
			out.Confidence = 0.8
			out.Reasons = append(out.Reasons, "命中文本分类规则: "+rule.taskType)
			return out
		}
	}

	if fallback != nil {
		classificationReq := req
		classificationReq.ExplicitAgentID = 0
		classificationReq.AllowedAgentIDs = nil
		classificationReq.EnforceAllowedAgents = false
		llmOut, err := fallback.ClassifyDispatchTask(ctx, classificationReq)
		if err == nil {
			llmOut.TaskType = normalizeDispatchValue(llmOut.TaskType)
			llmOut.RequiredRole = strings.TrimSpace(llmOut.RequiredRole)
			llmOut.RequiredCapabilities = normalizeDispatchList(llmOut.RequiredCapabilities)
			llmOut.OptionalTags = normalizeDispatchList(llmOut.OptionalTags)
			llmOut.RequiredPermissions = normalizeDispatchPermissions(llmOut.RequiredPermissions)
			llmOut.Source = "llm"
			llmOut.LLMUsed = true
			fillDispatchType(&llmOut)
			if llmOut.TaskType != "" || llmOut.RequiredRole != "" {
				fillDispatchRole(&llmOut)
				llmOut.Confidence = clampDispatchScore(llmOut.Confidence)
				llmOut.Reasons = append(llmOut.Reasons, "规则无法归类，使用 LLM 结构化分类")
				if llmOut.RequiredRole == "" && len(llmOut.RequiredCapabilities) == 0 && len(llmOut.RequiredPermissions) == 0 {
					llmOut.Source = "manual"
					llmOut.NeedsManual = true
					llmOut.Reasons = append(llmOut.Reasons, "LLM 分类缺少可验证的岗位、能力或权限约束")
				}
				return llmOut
			}
			err = fmt.Errorf("LLM 未返回任务类型")
		}
		out.FallbackError = err.Error()
		out.LLMUsed = true
	}
	out.Source = "manual"
	out.NeedsManual = true
	out.Reasons = append(out.Reasons, "规则无法可靠归类，等待人工补充岗位或标签")
	return out
}

func parseDispatchLabels(labels []string, out *DispatchClassification) {
	for _, raw := range labels {
		label := strings.TrimSpace(raw)
		lower := strings.ToLower(label)
		switch {
		case strings.HasPrefix(lower, "type:") || strings.HasPrefix(lower, "类型:"):
			out.TaskType = normalizeDispatchValue(label[strings.Index(label, ":")+1:])
		case strings.HasPrefix(lower, "role:") || strings.HasPrefix(lower, "岗位:"):
			out.RequiredRole = strings.TrimSpace(label[strings.Index(label, ":")+1:])
		case strings.HasPrefix(lower, "cap:") || strings.HasPrefix(lower, "capability:") || strings.HasPrefix(lower, "能力:"):
			out.RequiredCapabilities = appendUniqueDispatch(out.RequiredCapabilities, label[strings.Index(label, ":")+1:])
		case strings.HasPrefix(lower, "tag:") || strings.HasPrefix(lower, "标签:"):
			out.OptionalTags = appendUniqueDispatch(out.OptionalTags, label[strings.Index(label, ":")+1:])
		case strings.HasPrefix(lower, "perm:") || strings.HasPrefix(lower, "permission:") || strings.HasPrefix(lower, "权限:"):
			out.RequiredPermissions = appendUniqueDispatch(out.RequiredPermissions, label[strings.Index(label, ":")+1:])
		default:
			for _, rule := range dispatchRules {
				if dispatchValueIn(lower, rule.aliases) {
					out.TaskType = rule.taskType
					if out.RequiredRole == "" {
						out.RequiredRole = rule.role
					}
				}
			}
		}
	}
	out.RequiredCapabilities = normalizeDispatchList(out.RequiredCapabilities)
	out.OptionalTags = normalizeDispatchList(out.OptionalTags)
	out.RequiredPermissions = normalizeDispatchPermissions(out.RequiredPermissions)
}

func fillDispatchRole(out *DispatchClassification) {
	if out.RequiredRole != "" {
		return
	}
	for _, rule := range dispatchRules {
		if out.TaskType == rule.taskType {
			out.RequiredRole = rule.role
			return
		}
	}
}

func fillDispatchType(out *DispatchClassification) {
	if out.TaskType != "" || out.RequiredRole == "" {
		return
	}
	for _, rule := range dispatchRules {
		if dispatchRoleMatches(out.RequiredRole, rule.role) {
			out.TaskType = rule.taskType
			return
		}
	}
}

// RankDispatchCandidates 执行硬约束过滤后评分；显式指定 Agent 也不能绕过任何检查。
func RankDispatchCandidates(classification DispatchClassification, agents []DispatchAgentProfile, explicitAgentID int64) DispatchRecommendation {
	result := DispatchRecommendation{Classification: classification, NeedsManual: classification.NeedsManual}
	if classification.NeedsManual {
		result.Reason = "任务尚未完成分类"
		return result
	}
	if explicitAgentID > 0 {
		found := false
		for _, agent := range agents {
			if agent.ID == explicitAgentID {
				agents = []DispatchAgentProfile{agent}
				found = true
				break
			}
		}
		if !found {
			result.NeedsManual = true
			result.Reason = "指定数字员工不存在"
			result.Rejected = append(result.Rejected, DispatchRejection{AgentID: explicitAgentID, Reasons: []string{"指定数字员工不存在"}})
			return result
		}
	}

	for _, agent := range agents {
		reasons := dispatchHardConstraintFailures(classification, agent)
		if len(reasons) > 0 {
			result.Rejected = append(result.Rejected, DispatchRejection{AgentID: agent.ID, AgentName: agent.Name, Reasons: reasons})
			continue
		}
		result.Alternatives = append(result.Alternatives, scoreDispatchCandidate(classification, agent))
	}
	sort.SliceStable(result.Alternatives, func(i, j int) bool {
		a, b := result.Alternatives[i], result.Alternatives[j]
		if math.Abs(a.Score-b.Score) > 0.000001 {
			return a.Score > b.Score
		}
		if a.ActiveTasks != b.ActiveTasks {
			return a.ActiveTasks < b.ActiveTasks
		}
		if a.Occupied != b.Occupied {
			return !a.Occupied
		}
		return a.AgentID < b.AgentID
	})
	if len(result.Alternatives) == 0 {
		result.NeedsManual = true
		if explicitAgentID > 0 {
			result.Reason = "指定数字员工未通过安全校验"
		} else {
			result.Reason = "没有满足岗位、能力、权限和容量要求的数字员工"
		}
		return result
	}
	recommended := result.Alternatives[0]
	result.Recommended = &recommended
	result.Alternatives = append([]DispatchCandidate(nil), result.Alternatives[1:]...)
	return result
}

func dispatchHardConstraintFailures(c DispatchClassification, a DispatchAgentProfile) []string {
	var reasons []string
	if !a.AcceptsTasks {
		reasons = append(reasons, "未启用接单")
	}
	switch strings.ToLower(strings.TrimSpace(a.Status)) {
	case "error", "initializing", "disabled", "offline":
		reasons = append(reasons, "状态不健康: "+strings.TrimSpace(a.Status))
	}
	if c.RequiredRole != "" && !dispatchRoleMatches(a.JobRole, c.RequiredRole) {
		reasons = append(reasons, "岗位不匹配")
	}
	capabilities := dispatchSet(a.Capabilities)
	for _, required := range c.RequiredCapabilities {
		if !capabilities[normalizeDispatchValue(required)] {
			reasons = append(reasons, "缺少能力: "+required)
		}
	}
	for _, required := range c.RequiredPermissions {
		key := normalizeDispatchPermission(required)
		if key == "" || !a.Permissions[key] {
			reasons = append(reasons, "缺少权限: "+required)
		}
	}
	maxActive := a.MaxActive
	if maxActive <= 0 {
		maxActive = store.TaskQueueMaxActive
	}
	if a.ActiveTasks >= maxActive {
		reasons = append(reasons, "已达到并发/队列上限")
	}
	return reasons
}

func scoreDispatchCandidate(c DispatchClassification, a DispatchAgentProfile) DispatchCandidate {
	tags := dispatchSet(append(append([]string{}, a.Tags...), a.Capabilities...))
	matched := make([]string, 0, len(c.OptionalTags))
	for _, tag := range c.OptionalTags {
		if tags[normalizeDispatchValue(tag)] {
			matched = append(matched, tag)
		}
	}
	loadUnits := a.ActiveTasks
	if a.Occupied {
		loadUnits++
	}
	loadScore := 1 / float64(1+loadUnits)
	tagScore := 0.0
	if len(c.OptionalTags) > 0 {
		tagScore = float64(len(matched)) / float64(len(c.OptionalTags))
	}
	score := loadScore
	if len(c.OptionalTags) > 0 {
		// 当前无可靠历史成功率，按 50:30 重新归一化为 62.5%:37.5%。
		score = tagScore*0.625 + loadScore*0.375
	}
	reasons := []string{fmt.Sprintf("当前活跃任务 %d", a.ActiveTasks)}
	if len(matched) > 0 {
		reasons = append(reasons, "匹配标签: "+strings.Join(matched, ", "))
	}
	if a.Occupied {
		reasons = append(reasons, "当前存在主任务占用")
	}
	return DispatchCandidate{
		AgentID: a.ID, AgentName: a.Name, Score: math.Round(score*10000) / 100,
		ActiveTasks: a.ActiveTasks, Occupied: a.Occupied, MatchedTags: matched, Reasons: reasons,
		StableSortKey: fmt.Sprintf("%012d", a.ID),
	}
}

// RecommendTaskDispatch 汇集现有岗位、技能能力、权限、Occupancy 和队列负载后给出建议。
func (s *Service) RecommendTaskDispatch(ctx context.Context, req DispatchTaskRequest, fallback DispatchClassificationFallback) (DispatchRecommendation, error) {
	classification := ClassifyDispatchTask(ctx, req, fallback)
	agents, err := s.loadDispatchAgentProfiles(ctx)
	if err != nil {
		return DispatchRecommendation{}, err
	}
	if req.EnforceAllowedAgents || len(req.AllowedAgentIDs) > 0 {
		allowed := make(map[int64]bool, len(req.AllowedAgentIDs))
		for _, id := range req.AllowedAgentIDs {
			if id > 0 {
				allowed[id] = true
			}
		}
		filtered := agents[:0]
		for _, agent := range agents {
			if allowed[agent.ID] {
				filtered = append(filtered, agent)
			}
		}
		agents = filtered
	}
	return RankDispatchCandidates(classification, agents, req.ExplicitAgentID), nil
}

func (s *Service) loadDispatchAgentProfiles(ctx context.Context) ([]DispatchAgentProfile, error) {
	agents, err := s.Store.ListManagedAgents(ctx)
	if err != nil {
		return nil, err
	}
	occupancy, err := s.Store.ListOccupancyMap(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]DispatchAgentProfile, 0, len(agents))
	for _, agent := range agents {
		active, err := s.Store.CountAgentTaskActive(ctx, agent.ID)
		if err != nil {
			return nil, err
		}
		skills, err := s.Store.ListInstalledAgentSkills(ctx, agent.ID)
		if err != nil {
			return nil, err
		}
		var capabilities, tags []string
		for _, skill := range skills {
			tags = append(tags, skill.ID)
			capabilities = append(capabilities, skill.Capabilities...)
		}
		out = append(out, DispatchAgentProfile{
			ID: agent.ID, Name: agent.Name, JobRole: agent.JobRole, Status: agent.Status,
			AcceptsTasks: !agent.IsReceptionist, Capabilities: normalizeDispatchList(capabilities),
			Tags: normalizeDispatchList(tags), ActiveTasks: active, MaxActive: store.TaskQueueMaxActive,
			Occupied: occupancy[agent.ID].AgentID != 0,
			Permissions: map[string]bool{
				"write": agent.AllowWrite, "network": agent.AllowNetwork,
				"rm": agent.AllowRm, "browser": agent.AllowBrowser,
			},
		})
	}
	return out, nil
}

func containsDispatchKeyword(text string, keywords []string) bool {
	for _, keyword := range keywords {
		if strings.Contains(text, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

func dispatchValueIn(value string, values []string) bool {
	for _, candidate := range values {
		if value == strings.ToLower(candidate) {
			return true
		}
	}
	return false
}

func normalizeDispatchValue(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeDispatchList(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = normalizeDispatchValue(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}

func normalizeDispatchPermission(value string) string {
	normalized := normalizeDispatchValue(value)
	switch normalized {
	case "write", "file_write", "写入":
		return "write"
	case "network", "net", "联网":
		return "network"
	case "rm", "delete", "删除":
		return "rm"
	case "browser", "浏览器":
		return "browser"
	default:
		// 未知权限必须保留，后续硬约束会因 Agent 未声明该权限而拒绝，不能静默放行。
		return normalized
	}
}

func normalizeDispatchPermissions(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if normalized := normalizeDispatchPermission(value); normalized != "" {
			out = appendUniqueDispatch(out, normalized)
		}
	}
	sort.Strings(out)
	return out
}

func appendUniqueDispatch(values []string, value string) []string {
	value = normalizeDispatchValue(value)
	if value == "" {
		return values
	}
	for _, existing := range values {
		if normalizeDispatchValue(existing) == value {
			return values
		}
	}
	return append(values, value)
}

func dispatchSet(values []string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, value := range values {
		if value = normalizeDispatchValue(value); value != "" {
			out[value] = true
		}
	}
	return out
}

func clampDispatchScore(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func dispatchRoleMatches(agentRole, requiredRole string) bool {
	agentRole = normalizeDispatchValue(agentRole)
	requiredRole = normalizeDispatchValue(requiredRole)
	if agentRole == "" || requiredRole == "" {
		return false
	}
	return agentRole == requiredRole || strings.Contains(agentRole, requiredRole) || strings.Contains(requiredRole, agentRole)
}
