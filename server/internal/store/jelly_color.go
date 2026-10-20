package store

import (
	"fmt"
	"strings"
)

// JellyColors 像素小水母可选颜色（同一造型换色）。
var JellyColors = []string{"orange", "yellow", "blue", "green", "purple", "red"}

// ErrInvalidJellyColor 非法 jelly_color。
var ErrInvalidJellyColor = fmt.Errorf("jelly_color must be orange|yellow|blue|green|purple|red")

// ValidJellyColor 校验颜色取值（大小写不敏感，返回前建议 Normalize）。
func ValidJellyColor(c string) bool {
	switch strings.ToLower(strings.TrimSpace(c)) {
	case "orange", "yellow", "blue", "green", "purple", "red":
		return true
	default:
		return false
	}
}

// NormalizeJellyColor 规范化为小写合法色；非法返回空串。
func NormalizeJellyColor(c string) string {
	c = strings.ToLower(strings.TrimSpace(c))
	if !ValidJellyColor(c) {
		return ""
	}
	return c
}

// AssignJellyColor 按员工 id 稳定轮转分配颜色，便于同组分散。
func AssignJellyColor(id int64) string {
	if id < 0 {
		id = -id
	}
	return JellyColors[int(id%int64(len(JellyColors)))]
}

// ResolveJellyColor 创建时解析颜色：显式合法值优先，否则按 id 自动分配。
// explicit 为空表示未指定；非空但非法返回 ErrInvalidJellyColor。
func ResolveJellyColor(id int64, explicit string) (string, error) {
	explicit = strings.TrimSpace(explicit)
	if explicit == "" {
		return AssignJellyColor(id), nil
	}
	c := NormalizeJellyColor(explicit)
	if c == "" {
		return "", ErrInvalidJellyColor
	}
	return c, nil
}
