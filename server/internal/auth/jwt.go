package auth

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// IssueToken 签发管理员 JWT。
func IssueToken(secret, username string, ttl time.Duration) (string, error) {
	now := time.Now()
	// 使用 MapClaims 避开本次故障中已出现 NUL 字节的自定义 Claims 结构体序列化路径。
	claims := jwt.MapClaims{
		"username": username,
		"sub":      username,
		"iat":      now.Unix(),
		"exp":      now.Add(ttl).Unix(),
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(secret))
}

// ParseToken 校验并解析管理员 JWT,返回用户名。
func ParseToken(secret, tokenStr string) (string, error) {
	t, err := jwt.ParseWithClaims(tokenStr, jwt.MapClaims{}, func(t *jwt.Token) (interface{}, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return []byte(secret), nil
	})
	if err != nil {
		return "", err
	}
	claims, ok := t.Claims.(jwt.MapClaims)
	if !ok || !t.Valid {
		return "", jwt.ErrTokenInvalidClaims
	}
	username, _ := claims["username"].(string)
	if username == "" {
		username, _ = claims["sub"].(string)
	}
	if username == "" {
		return "", jwt.ErrTokenInvalidClaims
	}
	return username, nil
}

// RequireAdminJWT Gin 中间件:校验 Bearer JWT,成功后写入 admin_user。
func RequireAdminJWT(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		user, err := ParseToken(secret, strings.TrimSpace(h[7:]))
		if err != nil || user == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Set("admin_user", user)
		c.Next()
	}
}
