package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"atolla/server/internal/service"
	"github.com/gin-gonic/gin"
)

type taskQueueBody struct {
	Question    string `json:"question"`
	Attachments []struct {
		ID   string `json:"id"`
		URL  string `json:"url"`
		Mime string `json:"mime"`
		Name string `json:"name"`
	} `json:"attachments"`
}

func parseTaskQueueAtts(in []struct {
	ID   string `json:"id"`
	URL  string `json:"url"`
	Mime string `json:"mime"`
	Name string `json:"name"`
}) []service.TaskQueueAttachment {
	out := make([]service.TaskQueueAttachment, 0, len(in))
	for _, a := range in {
		out = append(out, service.TaskQueueAttachment{ID: a.ID, URL: a.URL, Mime: a.Mime, Name: a.Name})
	}
	return out
}

func taskQueueHTTPError(c *gin.Context, err error) {
	if err == nil {
		return
	}
	msg := err.Error()
	status := http.StatusBadRequest
	switch {
	case errors.Is(err, service.ErrTaskQueueFull) || strings.Contains(msg, "已满"):
		status = http.StatusConflict
	case errors.Is(err, service.ErrTaskQueuePauseFull) || strings.Contains(msg, "打断次数"):
		status = http.StatusConflict
	case errors.Is(err, service.ErrTaskQueueLocked) || strings.Contains(msg, "占用"):
		status = http.StatusConflict
	case strings.Contains(msg, "not found"):
		status = http.StatusNotFound
	}
	c.JSON(status, gin.H{"error": msg})
}

// AdminAgentTaskQueueList 任务队列轨数据。
func (h *Handler) AdminAgentTaskQueueList(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	view, err := h.svc.ListTaskQueue(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, view)
}

// AdminAgentTaskQueueEnqueue 追加队列末尾。
func (h *Handler) AdminAgentTaskQueueEnqueue(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body taskQueueBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	out, err := h.svc.EnqueueAgentTaskEx(c.Request.Context(), id, body.Question, parseTaskQueueAtts(body.Attachments))
	if err != nil {
		taskQueueHTTPError(c, err)
		return
	}
	if out.Item == nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}
	// 兼容旧前端：正文仍是队列项；kickoff 表示空闲入队需立刻 Ask
	c.JSON(http.StatusOK, gin.H{
		"id":               out.Item.ID,
		"agent_id":         out.Item.AgentID,
		"conversation_id":  out.Item.ConversationID,
		"status":           out.Item.Status,
		"question":         out.Item.Question,
		"attachments_json": out.Item.AttachmentsJSON,
		"position":         out.Item.Position,
		"pause_rank":       out.Item.PauseRank,
		"silent_notify":    out.Item.SilentNotify,
		"created_at":       out.Item.CreatedAt,
		"started_at":       out.Item.StartedAt,
		"finished_at":      out.Item.FinishedAt,
		"error_text":       out.Item.ErrorText,
		"resume_hint":      out.Item.ResumeHint,
		"kickoff":          out.Kickoff,
	})
}

// AdminAgentTaskQueueInterrupt 打断优先：取消当前执行，调用方随后直发 Ask（不入队）。
func (h *Handler) AdminAgentTaskQueueInterrupt(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body taskQueueBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if _, err := h.svc.InterruptPreferAgentTask(c.Request.Context(), id, body.Question, parseTaskQueueAtts(body.Attachments)); err != nil {
		taskQueueHTTPError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "direct": true})
}

// AdminAgentTaskQueueContinue 继续队列（清 hold 并 claim 下一条）。
func (h *Handler) AdminAgentTaskQueueContinue(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	item, err := h.svc.ContinueAgentTaskQueue(c.Request.Context(), id)
	if err != nil {
		taskQueueHTTPError(c, err)
		return
	}
	if item == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "task": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "task": item, "resume_prefix": item.ResumeHint})
}

// AdminAgentTaskQueueCancel 取消 queued/paused。
func (h *Handler) AdminAgentTaskQueueCancel(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	taskID, _ := strconv.ParseInt(c.Param("taskId"), 10, 64)
	if err := h.svc.CancelAgentTaskQueueItem(c.Request.Context(), id, taskID); err != nil {
		taskQueueHTTPError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentTaskQueueUpdate 改写未执行项文案（queued/paused）。
func (h *Handler) AdminAgentTaskQueueUpdate(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	taskID, _ := strconv.ParseInt(c.Param("taskId"), 10, 64)
	var body taskQueueBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.UpdateAgentTaskQueueQuestion(c.Request.Context(), id, taskID, body.Question); err != nil {
		taskQueueHTTPError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentTaskQueueClearDone 清除终态展示。
func (h *Handler) AdminAgentTaskQueueClearDone(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := h.svc.ClearAgentTaskQueueDone(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
