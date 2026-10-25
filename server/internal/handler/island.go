package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/service"
)

// AdminIslandSync POST /api/admin/island/sync — 把当前 Bearer 写入 ~/.atolla/island.json 供灵动岛读取。
func (h *Handler) AdminIslandSync(c *gin.Context) {
	auth := c.GetHeader("Authorization")
	token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	if token == "" {
		token = strings.TrimSpace(strings.TrimPrefix(auth, "bearer "))
	}
	var body struct {
		APIBase string `json:"api_base"`
		WebBase string `json:"web_base"`
	}
	_ = c.ShouldBindJSON(&body)
	path, err := h.svc.SyncIslandConfig(token, body.APIBase, body.WebBase)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "path": path})
}

// AdminIslandBusy GET /api/admin/island/busy — 忙碌数字人列表（岛轮询）。
func (h *Handler) AdminIslandBusy(c *gin.Context) {
	items, err := h.svc.ListIslandBusyAgents(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []service.IslandBusyAgent{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

// AdminIslandEvents GET /api/admin/island/events — 返回当前最高优先级的灵动岛事件。
func (h *Handler) AdminIslandEvents(c *gin.Context) {
	presentation, err := h.svc.ListIslandEvents(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, presentation)
}

// AdminIslandSettingsGet GET /api/admin/island/settings?force=1 — 灵动岛安装/启用状态（默认读缓存）。
func (h *Handler) AdminIslandSettingsGet(c *gin.Context) {
	force := c.Query("force") == "1" || c.Query("force") == "true"
	st, err := h.svc.GetIslandSettingsStatus(force)
	if err != nil {
		c.JSON(http.StatusOK, st) // 仍返回结构体，便于 UI 展示 detail
		return
	}
	c.JSON(http.StatusOK, st)
}

// AdminIslandSettingsInstall POST /api/admin/island/settings/install — 从最新 GitHub Release 自动安装。
func (h *Handler) AdminIslandSettingsInstall(c *gin.Context) {
	st, err := h.svc.InstallIsland()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":       err.Error(),
			"installed":   st.Installed,
			"enabled":     st.Enabled,
			"has_source":  st.HasSource,
			"has_xcode":   st.HasXcode,
			"detail":      st.Detail,
			"repo_hint":   st.RepoHint,
			"source_path": st.SourcePath,
			"release_tag": st.ReleaseTag,
			"release_url": st.ReleaseURL,
		})
		return
	}
	c.JSON(http.StatusOK, st)
}

// AdminIslandSettingsUninstall DELETE /api/admin/island/settings — 卸载并清理本机组件。
func (h *Handler) AdminIslandSettingsUninstall(c *gin.Context) {
	st, err := h.svc.UninstallIsland()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     err.Error(),
			"installed": st.Installed,
			"enabled":   st.Enabled,
			"detail":    st.Detail,
		})
		return
	}
	c.JSON(http.StatusOK, st)
}

// AdminIslandSettingsPut PUT /api/admin/island/settings — 胶囊开关：{ enabled: bool }。
func (h *Handler) AdminIslandSettingsPut(c *gin.Context) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	st, err := h.svc.SetIslandEnabled(body.Enabled)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     err.Error(),
			"installed": st.Installed,
			"enabled":   st.Enabled,
			"detail":    st.Detail,
			"repo_hint": st.RepoHint,
			"release_tag": st.ReleaseTag,
			"release_url": st.ReleaseURL,
		})
		return
	}
	c.JSON(http.StatusOK, st)
}
