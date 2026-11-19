package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// SetupDBStatus GET /api/setup/db-status
func (h *Handler) SetupDBStatus(c *gin.Context) {
	st, err := h.svc.GetDBStatus(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, st)
}

// SetupDBChoose POST /api/setup/db-choose  body: {driver, migrate?}
func (h *Handler) SetupDBChoose(c *gin.Context) {
	var body struct {
		Driver  string `json:"driver"`
		Migrate *bool  `json:"migrate"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	migrate := true
	if body.Migrate != nil {
		migrate = *body.Migrate
	}
	res, err := h.svc.SetupChooseDB(c.Request.Context(), body.Driver, migrate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// AdminDBStatus GET /api/admin/db/status
func (h *Handler) AdminDBStatus(c *gin.Context) {
	st, err := h.svc.GetDBStatus(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, st)
}

// AdminDBSwitch POST /api/admin/db/switch
func (h *Handler) AdminDBSwitch(c *gin.Context) {
	var body struct {
		Driver  string `json:"driver"`
		Migrate bool   `json:"migrate"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.AdminSwitchDB(c.Request.Context(), body.Driver, body.Migrate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// AdminDBSQLitePath POST /api/admin/db/sqlite-path  body: {path, migrate?}
func (h *Handler) AdminDBSQLitePath(c *gin.Context) {
	var body struct {
		Path    string `json:"path"`
		Migrate bool   `json:"migrate"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.AdminSetSQLitePath(c.Request.Context(), body.Path, body.Migrate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// AdminDBMigrateProgress GET /api/admin/db/migrate-progress
func (h *Handler) AdminDBMigrateProgress(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.MigrateProgress())
}
