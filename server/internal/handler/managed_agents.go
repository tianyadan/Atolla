package handler

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/notify"
	"atolla/server/internal/service"
	"atolla/server/internal/store"
)

// AdminAgentsList 数字员工列表。
func (h *Handler) AdminAgentsList(c *gin.Context) {
	ctx := c.Request.Context()
	items, err := h.svc.Store.ListManagedAgents(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []store.ManagedAgent{}
	}
	items = h.svc.EnrichAgentsFolderNames(ctx, items)
	skillCounts, _ := h.svc.Store.CountInstalledSkillsMap(ctx)
	skillIcons, _ := h.svc.Store.ListInstalledSkillIconsByAgents(ctx)
	occMap, _ := h.svc.Store.ListOccupancyMap(ctx)
	viewingID, viewingOK := int64(0), false
	if h.svc.RemoteBridge != nil {
		viewingID, viewingOK = h.svc.RemoteBridge.MobileViewingAgentID()
	}
	type row struct {
		store.ManagedAgent
		Occupancy     *store.Occupancy `json:"occupancy,omitempty"`
		MobileViewing bool             `json:"mobile_viewing"`
	}
	out := make([]row, 0, len(items))
	for _, a := range items {
		a.SkillCount = skillCounts[a.ID]
		a.SkillIcons = skillIcons[a.ID]
		r := row{ManagedAgent: a, MobileViewing: viewingOK && a.ID == viewingID}
		if o, ok := occMap[a.ID]; ok {
			oc := o
			r.Occupancy = &oc
		}
		out = append(out, r)
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}

// AdminAgentsCreate 一键招聘数字员工。
func (h *Handler) AdminAgentsCreate(c *gin.Context) {
	var body struct {
		Name                string  `json:"name"`
		Engine              string  `json:"engine"`
		ContextWindowTokens *int64  `json:"context_window_tokens"`
		BinPath             string  `json:"bin_path"`
		RulesPrompt         string  `json:"rules_prompt"`
		AllowWrite          *bool   `json:"allow_write"`
		AllowNetwork        *bool   `json:"allow_network"`
		AllowRm             *bool   `json:"allow_rm"`
		AllowBrowser        *bool   `json:"allow_browser"`
		WorkspacePath       string  `json:"workspace_path"`
		ScheduleEnabled     bool    `json:"schedule_enabled"`
		ScheduleCron        string  `json:"schedule_cron"`
		ScheduleLabel       string  `json:"schedule_label"`
		JellyColor          *string `json:"jelly_color"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	name := strings.TrimSpace(body.Name)
	engine := strings.ToLower(strings.TrimSpace(body.Engine))
	if name == "" {
		name = "未命名员工"
	}
	if !store.ValidEngine(engine) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "engine must be claude|codex|agent"})
		return
	}
	if body.ContextWindowTokens != nil && !store.ValidContextWindow(*body.ContextWindowTokens) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid context_window_tokens"})
		return
	}
	if body.JellyColor != nil {
		if store.NormalizeJellyColor(*body.JellyColor) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": store.ErrInvalidJellyColor.Error()})
			return
		}
		norm := store.NormalizeJellyColor(*body.JellyColor)
		body.JellyColor = &norm
	}
	ws := strings.TrimSpace(body.WorkspacePath)
	se := body.ScheduleEnabled
	cron := strings.TrimSpace(body.ScheduleCron)
	label := strings.TrimSpace(body.ScheduleLabel)
	in := store.ManagedAgentInput{
		Name: name, Engine: engine, ContextWindowTokens: body.ContextWindowTokens, BinPath: strings.TrimSpace(body.BinPath), RulesPrompt: body.RulesPrompt,
		AllowWrite: body.AllowWrite, AllowNetwork: body.AllowNetwork, AllowRm: body.AllowRm, AllowBrowser: body.AllowBrowser,
		WorkspacePath: &ws, ScheduleEnabled: &se, ScheduleCron: &cron, ScheduleLabel: &label,
		JellyColor: body.JellyColor,
	}
	id, err := h.svc.Store.CreateManagedAgent(c.Request.Context(), in)
	if err != nil {
		if err == store.ErrInvalidJellyColor {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	a, _ := h.svc.Store.GetManagedAgent(c.Request.Context(), id)
	if h.svc.Sched != nil {
		h.svc.Sched.Reload(c.Request.Context())
	}
	// 新员工默认未入组；立刻推镜像，避免手机还停在上一份名单。
	h.svc.PushAgentsMirrorNow()
	c.JSON(http.StatusOK, a)
}

// AdminAgentsCopy 复制数字员工（独立 session，异步隐藏初始化）。
func (h *Handler) AdminAgentsCopy(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var body struct {
		Name       string  `json:"name"`
		AvatarURL  string  `json:"avatar_url"`
		JellyColor *string `json:"jelly_color"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name required"})
		return
	}
	if body.JellyColor != nil {
		if store.NormalizeJellyColor(*body.JellyColor) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": store.ErrInvalidJellyColor.Error()})
			return
		}
		norm := store.NormalizeJellyColor(*body.JellyColor)
		body.JellyColor = &norm
	}
	a, err := h.svc.CopyManagedAgent(c.Request.Context(), id, name, strings.TrimSpace(body.AvatarURL), body.JellyColor)
	if err != nil {
		if service.IsInitializingConflict(err) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		if err == store.ErrInvalidJellyColor {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, a)
}

// AdminAgentsRetryInit 复制初始化失败后重试。
func (h *Handler) AdminAgentsRetryInit(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	a, err := h.svc.RetryCloneInit(c.Request.Context(), id)
	if err != nil {
		if service.IsInitializingConflict(err) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, a)
}

// AdminAgentsUpdate 重命名 / 改规则 / 改 bin / 权限策略。
func (h *Handler) AdminAgentsUpdate(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	raw, _ := io.ReadAll(c.Request.Body)
	var body map[string]json.RawMessage
	if err := json.Unmarshal(raw, &body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	in := store.ManagedAgentInput{}
	if v, ok := body["context_window_tokens"]; ok {
		var window int64
		if json.Unmarshal(v, &window) != nil || !store.ValidContextWindow(window) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid context_window_tokens"})
			return
		}
		in.ContextWindowTokens = &window
	}
	if v, ok := body["name"]; ok {
		var s string
		_ = json.Unmarshal(v, &s)
		in.Name = s
	}
	if v, ok := body["bin_path"]; ok {
		var s string
		_ = json.Unmarshal(v, &s)
		in.BinPath = s
	}
	if v, ok := body["rules_prompt"]; ok {
		var s string
		_ = json.Unmarshal(v, &s)
		in.RulesPrompt = s
	}
	parseBoolPtr := func(key string) *bool {
		v, ok := body[key]
		if !ok {
			return nil
		}
		var b bool
		if json.Unmarshal(v, &b) != nil {
			return nil
		}
		return &b
	}
	parseStrPtr := func(key string) *string {
		v, ok := body[key]
		if !ok {
			return nil
		}
		var s string
		if json.Unmarshal(v, &s) != nil {
			return nil
		}
		return &s
	}
	in.AllowWrite = parseBoolPtr("allow_write")
	in.AllowNetwork = parseBoolPtr("allow_network")
	in.AllowRm = parseBoolPtr("allow_rm")
	in.AllowBrowser = parseBoolPtr("allow_browser")
	in.WorkspacePath = parseStrPtr("workspace_path")
	in.ScheduleEnabled = parseBoolPtr("schedule_enabled")
	in.ScheduleCron = parseStrPtr("schedule_cron")
	in.ScheduleLabel = parseStrPtr("schedule_label")
	if v, ok := body["jelly_color"]; ok {
		var s string
		if json.Unmarshal(v, &s) != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": store.ErrInvalidJellyColor.Error()})
			return
		}
		norm := store.NormalizeJellyColor(s)
		if norm == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": store.ErrInvalidJellyColor.Error()})
			return
		}
		in.JellyColor = &norm
	}

	if err := h.svc.Store.UpdateManagedAgent(c.Request.Context(), id, in); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if err == store.ErrInvalidJellyColor {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if h.svc.Sched != nil {
		h.svc.Sched.Reload(c.Request.Context())
	}
	a, _ := h.svc.Store.GetManagedAgent(c.Request.Context(), id)
	c.JSON(http.StatusOK, a)
}

// AdminAgentsDelete 解聘数字员工。
func (h *Handler) AdminAgentsDelete(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := h.svc.DeleteManaged(c.Request.Context(), id); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if h.svc.Sched != nil {
		h.svc.Sched.Reload(c.Request.Context())
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentsBatchDelete 批量解聘。
func (h *Handler) AdminAgentsBatchDelete(c *gin.Context) {
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ids required"})
		return
	}
	var failed []int64
	for _, id := range body.IDs {
		if err := h.svc.DeleteManaged(c.Request.Context(), id); err != nil {
			failed = append(failed, id)
		}
	}
	if h.svc.Sched != nil {
		h.svc.Sched.Reload(c.Request.Context())
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "failed": failed})
}

// AdminAgentsSetReceptionist 设为唯一前台助理。
func (h *Handler) AdminAgentsSetReceptionist(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := h.svc.Store.SetReceptionist(c.Request.Context(), id); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	a, _ := h.svc.Store.GetManagedAgent(c.Request.Context(), id)
	c.JSON(http.StatusOK, a)
}

// AdminAgentsClearReceptionist 取消前台助理（仅当当前为该人时）。
func (h *Handler) AdminAgentsClearReceptionist(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	cur, _ := h.svc.Store.GetReceptionist(c.Request.Context())
	if cur == nil || cur.ID != id {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}
	if err := h.svc.Store.SetReceptionist(c.Request.Context(), 0); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentsMessages 当前对话消息(分页:默认最新 20 条;before_id 上翻更早)。
func (h *Handler) AdminAgentsMessages(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	a, err := h.svc.Store.GetManagedAgent(c.Request.Context(), id)
	if err != nil || a == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	beforeID, _ := strconv.ParseInt(c.DefaultQuery("before_id", "0"), 10, 64)
	// 打开对话首页视为已读，清除任务完成未读
	if beforeID == 0 && a.TaskUnread {
		_ = h.svc.MarkAgentTaskRead(c.Request.Context(), id)
	}
	if a.ConversationID == 0 {
		c.JSON(http.StatusOK, gin.H{"items": []store.Message{}, "conversation_id": 0, "total": 0, "has_more": false})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	items, total, hasMore, err := h.svc.Store.MessagesPage(c.Request.Context(), a.ConversationID, beforeID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []store.Message{}
	}
	c.JSON(http.StatusOK, gin.H{
		"items": items, "conversation_id": a.ConversationID,
		"total": total, "has_more": hasMore, "limit": limit,
	})
}

// AdminAgentsFile 读取数字员工工作区内的图片(鉴权;防目录穿越)。
func (h *Handler) AdminAgentsFile(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	raw := strings.TrimSpace(c.Query("path"))
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path required"})
		return
	}
	a, err := h.svc.Store.GetManagedAgent(c.Request.Context(), id)
	if err != nil || a == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	abs, ct, err := h.svc.ResolveAgentImage(a, raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Header("Cache-Control", "private, max-age=60")
	c.Header("Content-Type", ct)
	c.File(abs)
}

// AdminAgentsAsk SSE 提问数字员工(含授权事件转发)。
func (h *Handler) AdminAgentsAsk(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		Question    string `json:"question"`
		Attachments []struct {
			ID   string `json:"id"`
			URL  string `json:"url"`
			Mime string `json:"mime"`
			Name string `json:"name"`
		} `json:"attachments"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	atts := parseAskAttachments(body.Attachments)
	if strings.TrimSpace(body.Question) == "" && len(atts) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "question required"})
		return
	}

	// 先确保会话存在,便于按 conversation_id 过滤授权事件
	a, err := h.svc.Store.GetManagedAgent(c.Request.Context(), id)
	if err != nil || a == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	convID := a.ConversationID
	if convID == 0 {
		convID, err = h.svc.Store.CreateAgentConversation(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		_ = h.svc.Store.SetManagedAgentConversation(c.Request.Context(), id, convID)
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming unsupported"})
		return
	}

	var wmu sync.Mutex
	sendEvent := func(payload any) {
		wmu.Lock()
		defer wmu.Unlock()
		b, _ := json.Marshal(payload)
		_, _ = c.Writer.Write([]byte("data: " + string(b) + "\n\n"))
		flusher.Flush()
	}

	sub := h.svc.Perms.Subscribe()
	defer h.svc.Perms.Unsubscribe(sub)
	done := make(chan struct{})
	var fwd sync.WaitGroup
	fwd.Add(1)
	go func() {
		defer fwd.Done()
		for {
			select {
			case <-done:
				return
			case ev := <-sub:
				var payload map[string]interface{}
				if (ev.Kind == "request" || ev.Kind == "auto") && ev.Req != nil {
					if ev.Req.ConvID != convID {
						continue
					}
					typ := "permission_request"
					if ev.Kind == "auto" {
						typ = "permission_auto"
					}
					payload = map[string]interface{}{
						"type": typ, "request_id": ev.Req.ID, "tool_name": ev.Req.ToolName,
						"summary": ev.Req.Summary, "deadline": ev.Req.Deadline, "note": ev.Req.Note,
						"meaning": ev.Req.Meaning, "risk": ev.Req.Risk, "conversation_id": convID,
					}
				} else if ev.Kind == "command" && ev.Req != nil {
					// 必须按会话隔离：ConvID 缺失或与本轮不符时丢弃，避免串到其他数字人窗口。
					if ev.Req.ConvID == 0 || ev.Req.ConvID != convID {
						continue
					}
					payload = map[string]interface{}{
						"type": "command", "tool_name": ev.Req.ToolName, "summary": ev.Req.Summary,
						"decision": ev.Req.Decision, "decided_by": ev.Req.DecidedBy,
						"risk": ev.Req.Risk, "meaning": ev.Req.Meaning,
					}
					// 同步一条精简 activity,便于前端活动条展示
					sendEvent(map[string]interface{}{
						"type": "activity", "tool": ev.Req.ToolName,
						"summary": activitySummary(ev.Req.ToolName, ev.Req.Summary),
					})
				} else if ev.Kind == "resolved" && ev.Res != nil {
					// request_id 全局唯一；前端按本会话 permQueue 过滤，误转发无害
					payload = map[string]interface{}{"type": "permission_resolved", "request_id": ev.Res.ID, "behavior": ev.Res.Behavior, "by": ev.Res.By}
				} else {
					continue
				}
				sendEvent(payload)
			}
		}
	}()
	var stopOnce sync.Once
	stopForward := func() {
		stopOnce.Do(func() { close(done); fwd.Wait() })
	}
	defer stopForward()

	msg, askErr := h.svc.AskManagedWith(c.Request.Context(), id, body.Question, atts, func(ev map[string]any) {
		if ev == nil {
			return
		}
		if t, _ := ev["type"].(string); t == "chunk" {
			if c, ok := ev["content"].(string); ok {
				ev["content"] = strings.ReplaceAll(c, "\n", "\\n")
			}
		}
		sendEvent(ev)
	})
	stopForward()
	if askErr != nil {
		sendEvent(map[string]interface{}{"type": "error", "message": askErr.Error()})
		return
	}
	sendEvent(map[string]interface{}{
		"type": "done", "conversation_id": msg.ConversationID,
		"reply_ms": msg.ReplyMs, "status": msg.Status,
	})
}

// AdminAgentsMarkRead POST /api/admin/agents/:id/mark-read — 清除任务完成未读。
func (h *Handler) AdminAgentsMarkRead(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := h.svc.MarkAgentTaskRead(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "task_unread": false})
}

// AdminAgentsClear 清空对话。
func (h *Handler) AdminAgentsClear(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := h.svc.ClearManagedChat(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentsEnsureConversation 若尚无会话则创建（不替换已有会话）。
func (h *Handler) AdminAgentsEnsureConversation(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	conv, err := h.svc.EnsureManagedConversation(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"conversation_id": conv})
}

// AdminAgentsCompress 压缩上下文。
func (h *Handler) AdminAgentsCompress(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := h.svc.CompressManagedChat(c.Request.Context(), id); err != nil {
		if service.IsInitializingConflict(err) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		if occupancyBusyJSON(c, err) {
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentsTasks 该数字员工相关任务进度(按 agent_id；优先 managed 类型平台任务)。
func (h *Handler) AdminAgentsTasks(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	a, err := h.svc.Store.GetManagedAgent(c.Request.Context(), id)
	if err != nil || a == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	aid := strconv.FormatInt(a.ID, 10)
	items, err := h.svc.Store.AgentTasksByAgentID(c.Request.Context(), "managed", aid, "")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []store.AgentTask{}, "warning": err.Error()})
		return
	}
	if len(items) == 0 {
		items, err = h.svc.Store.AgentTasksByAgentID(c.Request.Context(), "", aid, "")
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"items": []store.AgentTask{}, "warning": err.Error()})
			return
		}
	}
	if items == nil {
		items = []store.AgentTask{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// AdminAgentsStop 终止当前进行中的数字员工问答。
func (h *Handler) AdminAgentsStop(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	ok := h.svc.StopManaged(id)
	c.JSON(http.StatusOK, gin.H{"ok": true, "stopped": ok})
}

// AdminAgentsCommandAudits 命令审批审计列表。
func (h *Handler) AdminAgentsCommandAudits(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	a, err := h.svc.Store.GetManagedAgent(c.Request.Context(), id)
	if err != nil || a == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	items, err := h.svc.Store.ListCommandAudits(c.Request.Context(), a.ConversationID, a.ID, 50)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []store.CommandAudit{}, "warning": err.Error()})
		return
	}
	if items == nil {
		items = []store.CommandAudit{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// AdminPCViewer 电脑端对话页心跳。agent_id≤0 表示离开。
func (h *Handler) AdminPCViewer(c *gin.Context) {
	var body struct {
		AgentID int64 `json:"agent_id"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.AgentID <= 0 {
		h.svc.ClearPCViewer()
	} else {
		h.svc.SetPCViewer(body.AgentID)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminNotifyPermission 未停留在该数字人对话时，推送待审批卡片（名称 + 头像 + 固定文案）。
func (h *Handler) AdminNotifyPermission(c *gin.Context) {
	var body struct {
		RequestID string `json:"request_id"`
		AgentID   int64  `json:"agent_id"`
		AgentName string `json:"agent_name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.RequestID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "request_id required"})
		return
	}
	sent := h.svc.PushBarkIfAllowed(body.AgentID, "perm:"+body.RequestID, notify.PermissionPendingText)
	c.JSON(http.StatusOK, gin.H{"ok": true, "sent": sent})
}

// AdminNotifyTaskDone 未停留在该数字人对话时，推送任务完成卡片。
func (h *Handler) AdminNotifyTaskDone(c *gin.Context) {
	var body struct {
		DedupeKey string `json:"dedupe_key"`
		AgentID   int64  `json:"agent_id"`
		AgentName string `json:"agent_name"`
		Task      string `json:"task"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.DedupeKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dedupe_key required"})
		return
	}
	sent := h.svc.PushBarkIfAllowed(body.AgentID, "done:"+strings.TrimSpace(body.DedupeKey), notify.TaskDoneText(body.Task))
	c.JSON(http.StatusOK, gin.H{"ok": true, "sent": sent})
}

// activitySummary 把授权命令压成活动条文案(不展开长 diff)。
func activitySummary(tool, summary string) string {
	tool = strings.TrimSpace(tool)
	summary = strings.TrimSpace(summary)
	if summary == "" {
		if tool == "" {
			return "正在调用工具…"
		}
		return "调用 " + tool + "…"
	}
	runes := []rune(summary)
	if len(runes) > 72 {
		summary = string(runes[:72]) + "…"
	}
	low := strings.ToLower(tool)
	if low == "bash" || low == "shell" {
		return "执行命令 · " + summary
	}
	return summary
}

// AdminAgentFoldersList 工作组列表。
func (h *Handler) AdminAgentFoldersList(c *gin.Context) {
	items, err := h.svc.Store.ListAgentFolders(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []store.AgentFolder{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// AdminAgentFoldersCreate 创建空工作组。
func (h *Handler) AdminAgentFoldersCreate(c *gin.Context) {
	var body struct {
		Name string `json:"name"`
	}
	_ = c.ShouldBindJSON(&body)
	id, err := h.svc.Store.CreateAgentFolder(c.Request.Context(), body.Name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "name": strings.TrimSpace(body.Name)})
}

// AdminAgentFoldersUpdate 重命名工作组。
func (h *Handler) AdminAgentFoldersUpdate(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.Store.RenameAgentFolder(c.Request.Context(), id, body.Name); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentFoldersDelete 删除工作组。
func (h *Handler) AdminAgentFoldersDelete(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := h.svc.Store.DeleteAgentFolder(c.Request.Context(), id); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentsSetFolder 拖拽归类：将数字员工移入工作组（folder_id=0 表示未入组）。
func (h *Handler) AdminAgentsSetFolder(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		FolderID int64 `json:"folder_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.Store.SetManagedAgentFolder(c.Request.Context(), id, body.FolderID); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	a, _ := h.svc.Store.GetManagedAgent(c.Request.Context(), id)
	c.JSON(http.StatusOK, a)
}

// AdminAgentsTaskPlan 开关任务规划（Ask 前 AI 拆分步骤与进度面板）。
func (h *Handler) AdminAgentsTaskPlan(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.Store.SetManagedAgentTaskPlan(c.Request.Context(), id, body.Enabled); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	a, _ := h.svc.Store.GetManagedAgent(c.Request.Context(), id)
	c.JSON(http.StatusOK, gin.H{"ok": true, "enabled": body.Enabled, "agent": a})
}

// AdminAgentsAutoApproveAll 开关「命令全部审批通过」。
func (h *Handler) AdminAgentsAutoApproveAll(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.Store.SetManagedAgentAutoApproveAll(c.Request.Context(), id, body.Enabled); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	a, _ := h.svc.Store.GetManagedAgent(c.Request.Context(), id)
	c.JSON(http.StatusOK, gin.H{"ok": true, "enabled": body.Enabled, "agent": a})
}

// AdminAgentsStatus 本地状态快照（不入库）；优先引擎真实上下文。
func (h *Handler) AdminAgentsStatus(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	text, err := h.svc.BuildAgentStatusReport(c.Request.Context(), id)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"text": text})
}

// AdminAgentsContext 引擎真实上下文占用（圆环 / 轮询）；fresh=1 强制探测。
func (h *Handler) AdminAgentsContext(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	fresh := c.Query("fresh") == "1" || c.Query("fresh") == "true"
	ctx, err := h.svc.FetchEngineContext(c.Request.Context(), id, fresh)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ctx)
}
