package handler

import (
	"net/http"
	"strconv"

	"atolla/server/internal/plugin/githubidea"
	"github.com/gin-gonic/gin"
)

// AdminGitHubIdeaGet GET /api/admin/plugins/github-idea — 返回脱敏配置与运行状态。
func (h *Handler) AdminGitHubIdeaGet(c *gin.Context) {
	if h.svc.GitHubIdea == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "GitHub Idea 插件未初始化"})
		return
	}
	out, err := h.svc.GitHubIdea.Get(c.Request.Context())
	if err != nil {
		// 状态内容仍可用于管理台定位 Keychain 或配置文件问题。
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "config": out})
		return
	}
	c.JSON(http.StatusOK, out)
}

// AdminGitHubIdeaDispatches GET /api/admin/plugins/github-idea/dispatches — 调度历史与状态。
func (h *Handler) AdminGitHubIdeaDispatches(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	items, err := h.svc.ListGitHubIdeaDispatches(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// AdminGitHubIdeaDispatchReassign POST .../dispatches/:id/reassign — 安全校验后手动重新分派。
func (h *Handler) AdminGitHubIdeaDispatchReassign(c *gin.Context) {
	dispatchID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || dispatchID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "调度记录 ID 无效"})
		return
	}
	var body struct {
		AgentID int64 `json:"agent_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.AgentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择数字员工"})
		return
	}
	out, err := h.svc.ReassignGitHubIdeaDispatch(c.Request.Context(), dispatchID, body.AgentID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

// AdminGitHubIdeaPut PUT /api/admin/plugins/github-idea — 保存仓库、凭据和数字员工配置。
func (h *Handler) AdminGitHubIdeaPut(c *gin.Context) {
	if h.svc.GitHubIdea == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "GitHub Idea 插件未初始化"})
		return
	}
	var body githubidea.ConfigUpdate
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "配置格式无效"})
		return
	}
	// 在插件边界前确认员工仍存在，避免保存悬空 ID。
	for _, agentID := range body.AgentIDs {
		agent, err := h.svc.Store.GetManagedAgent(c.Request.Context(), agentID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if agent == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "所选数字员工不存在或已被解聘"})
			return
		}
	}
	out, err := h.svc.GitHubIdea.Update(c.Request.Context(), body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}
