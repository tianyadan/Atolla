package handler

import (
	"net/http"
	"strconv"

	"atolla/server/internal/service"
	"github.com/gin-gonic/gin"
)

// AdminAgentTaskPlanActive 当前活跃计划。
func (h *Handler) AdminAgentTaskPlanActive(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	view, err := h.svc.LookupActiveTaskPlan(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if view == nil {
		c.JSON(http.StatusOK, gin.H{"plan": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"plan": view})
}

// AdminAgentTaskPlanConfirm 确认计划并开始执行。
func (h *Handler) AdminAgentTaskPlanConfirm(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	planID := c.Param("planId")
	var body struct {
		Steps []service.TaskPlanStep `json:"steps"`
	}
	_ = c.ShouldBindJSON(&body)
	view, err := h.svc.ConfirmTaskPlanSteps(c.Request.Context(), id, planID, body.Steps)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "plan": view})
}

// AdminAgentTaskPlanReject 拒绝计划。
func (h *Handler) AdminAgentTaskPlanReject(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	planID := c.Param("planId")
	if err := h.svc.RejectTaskPlanDraft(c.Request.Context(), id, planID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentTaskPlanAbort 终止计划。
func (h *Handler) AdminAgentTaskPlanAbort(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	planID := c.Param("planId")
	if err := h.svc.AbortTaskPlanRun(c.Request.Context(), id, planID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminAgentTaskPlanResume 继续暂停的计划。
func (h *Handler) AdminAgentTaskPlanResume(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	planID := c.Param("planId")
	if err := h.svc.ResumeTaskPlanRun(c.Request.Context(), id, planID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
