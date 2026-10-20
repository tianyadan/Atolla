package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/store"
)

// parseAgentAskAuditFilter 解析员工与时间范围；默认近 7 天。
func parseAgentAskAuditFilter(c *gin.Context) store.AgentAskAuditFilter {
	agentID, _ := strconv.ParseInt(c.DefaultQuery("agent_id", c.DefaultQuery("agentId", "0")), 10, 64)
	f := store.AgentAskAuditFilter{AgentID: agentID}
	now := time.Now()
	f.To = now
	f.From = now.Add(-7 * 24 * time.Hour)

	if rangeKey := strings.TrimSpace(c.Query("range")); rangeKey == "30d" {
		f.From = now.Add(-30 * 24 * time.Hour)
	}
	fromStr := strings.TrimSpace(c.Query("from"))
	toStr := strings.TrimSpace(c.Query("to"))
	if fromStr != "" {
		if t, ok := parseAuditTime(fromStr); ok {
			f.From = t
		}
	}
	if toStr != "" {
		if t, ok := parseAuditTime(toStr); ok {
			// 含当日：把 to 推到次日 0 点
			f.To = t.Add(24 * time.Hour)
			if len(toStr) > 10 {
				f.To = t
			}
		}
	}
	return f
}

func parseAuditTime(s string) (time.Time, bool) {
	layouts := []string{
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// AdminAgentAuditOverview 审计看板概览。
func (h *Handler) AdminAgentAuditOverview(c *gin.Context) {
	f := parseAgentAskAuditFilter(c)
	ov, err := h.svc.Store.AgentAskOverviewStats(c.Request.Context(), f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ov)
}

// AdminAgentAuditTokensDaily 每日 Token。
func (h *Handler) AdminAgentAuditTokensDaily(c *gin.Context) {
	f := parseAgentAskAuditFilter(c)
	items, err := h.svc.Store.AgentAskTokensDaily(c.Request.Context(), f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// AdminAgentAuditTokensWeekly 每周 Token。
func (h *Handler) AdminAgentAuditTokensWeekly(c *gin.Context) {
	f := parseAgentAskAuditFilter(c)
	items, err := h.svc.Store.AgentAskTokensWeekly(c.Request.Context(), f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// AdminAgentAuditTools 工具聚合。
func (h *Handler) AdminAgentAuditTools(c *gin.Context) {
	f := parseAgentAskAuditFilter(c)
	items, err := h.svc.Store.AgentAskToolAggregates(c.Request.Context(), f, 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// AdminAgentAuditErrors 最近错误。
func (h *Handler) AdminAgentAuditErrors(c *gin.Context) {
	f := parseAgentAskAuditFilter(c)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	items, err := h.svc.Store.ListAgentAskErrors(c.Request.Context(), f, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
