package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// AdminJevosSettingsGet GET /api/admin/jevos/settings?force=1
func (h *Handler) AdminJevosSettingsGet(c *gin.Context) {
	force := c.Query("force") == "1" || c.Query("force") == "true"
	st, err := h.svc.GetJevosSettingsStatus(force)
	if err != nil {
		c.JSON(http.StatusOK, st)
		return
	}
	c.JSON(http.StatusOK, st)
}

// AdminJevosSettingsInstall POST /api/admin/jevos/settings/install — body: { package_id, china_mirror }
func (h *Handler) AdminJevosSettingsInstall(c *gin.Context) {
	var body struct {
		PackageID   string `json:"package_id"`
		ChinaMirror bool   `json:"china_mirror"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.PackageID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "package_id required"})
		return
	}
	st, err := h.svc.InstallJevos(body.PackageID, body.ChinaMirror)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":       err.Error(),
			"installed":   st.Installed,
			"enabled":     st.Enabled,
			"healthy":     st.Healthy,
			"detail":      st.Detail,
			"packages":    st.Packages,
			"release_url": st.ReleaseURL,
		})
		return
	}
	c.JSON(http.StatusOK, st)
}

// AdminJevosSettingsPut PUT /api/admin/jevos/settings — { enabled: bool }
func (h *Handler) AdminJevosSettingsPut(c *gin.Context) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	st, err := h.svc.SetJevosEnabled(body.Enabled)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     err.Error(),
			"installed": st.Installed,
			"enabled":   st.Enabled,
			"healthy":   st.Healthy,
			"detail":    st.Detail,
			"packages":  st.Packages,
		})
		return
	}
	c.JSON(http.StatusOK, st)
}

// AdminJevosSettingsUninstall POST /api/admin/jevos/settings/uninstall — 卸载平台安装的 JEV
func (h *Handler) AdminJevosSettingsUninstall(c *gin.Context) {
	st, err := h.svc.UninstallJevos()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":         err.Error(),
			"installed":     st.Installed,
			"enabled":       st.Enabled,
			"healthy":       st.Healthy,
			"detail":        st.Detail,
			"packages":      st.Packages,
			"can_uninstall": st.CanUninstall,
		})
		return
	}
	c.JSON(http.StatusOK, st)
}
