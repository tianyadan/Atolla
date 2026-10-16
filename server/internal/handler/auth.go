package handler

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"atolla/server/internal/auth"
	"atolla/server/internal/enginecheck"
)

// Login 管理员登录,签发 JWT。已注册时只认数据库账号；未注册时回退环境变量，便于既有部署与测试。
func (h *Handler) Login(c *gin.Context) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	ok, user, err := h.matchAdmin(c, strings.TrimSpace(body.Username), body.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "账号或密码错误"})
		return
	}
	h.issueAdmin(c, user)
}

// RegisterAdmin 首位管理员注册。已有账号后关闭。
func (h *Handler) RegisterAdmin(c *gin.Context) {
	if h.svc.Store == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "数据库未就绪"})
		return
	}
	existing, err := h.svc.Store.GetAdminAccount(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if existing != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "管理员已注册，请直接登录"})
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Confirm  string `json:"confirm_password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	user := strings.TrimSpace(body.Username)
	if msg := validateAdminSignup(user, body.Password, body.Confirm); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "无法保存密码"})
		return
	}
	if err := h.svc.Store.CreateAdminAccount(c.Request.Context(), user, string(hash)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.issueAdmin(c, user)
}

// SetupStatus 首次引导：是否还需注册，以及三个工作引擎是否已安装。
func (h *Handler) SetupStatus(c *gin.Context) {
	needs := true
	if h.svc.Store != nil {
		acc, err := h.svc.Store.GetAdminAccount(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		needs = acc == nil
	}
	c.JSON(http.StatusOK, gin.H{
		"needs_register": needs,
		"engines":        enginecheck.Scan(),
	})
}

// matchAdmin 校验账号。库中已有管理员时不再接受环境变量口令。
func (h *Handler) matchAdmin(c *gin.Context, username, password string) (bool, string, error) {
	if h.svc.Store != nil {
		acc, err := h.svc.Store.GetAdminAccount(c.Request.Context())
		if err != nil {
			return false, "", err
		}
		if acc != nil {
			if acc.Username != username {
				return false, "", nil
			}
			if bcrypt.CompareHashAndPassword([]byte(acc.PasswordHash), []byte(password)) != nil {
				return false, "", nil
			}
			return true, acc.Username, nil
		}
	}
	cfg := h.svc.Cfg
	if username == cfg.AdminUser && password == cfg.AdminPass {
		return true, cfg.AdminUser, nil
	}
	return false, "", nil
}

// issueAdmin 签发管理员 JWT。
func (h *Handler) issueAdmin(c *gin.Context, username string) {
	cfg := h.svc.Cfg
	tok, err := auth.IssueToken(cfg.JWTSecret, username, cfg.JWTTTL())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "issue token: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": tok, "username": username})
}

// validateAdminSignup 检查注册账号与两次密码。
func validateAdminSignup(username, password, confirm string) string {
	n := utf8.RuneCountInString(username)
	if n < 2 || n > 32 {
		return "账号长度需要 2 到 32 个字符"
	}
	if strings.ContainsAny(username, " \t\r\n") {
		return "账号不能包含空白"
	}
	if utf8.RuneCountInString(password) < 8 {
		return "密码至少 8 位"
	}
	if password != confirm {
		return "两次密码不一致"
	}
	return ""
}

// Me 返回当前管理员身份。
func (h *Handler) Me(c *gin.Context) {
	user := c.GetString("admin_user")
	if user == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"username": user})
}

// Logout 客户端清 token;服务端无状态,直接成功。
func (h *Handler) Logout(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
