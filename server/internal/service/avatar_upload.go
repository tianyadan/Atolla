package service

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"

	"atolla/server/internal/store"
)

// UploadAgentAvatar 压缩并上传到 OSS，更新 avatar_url。
func (s *Service) UploadAgentAvatar(ctx context.Context, agentID int64, raw []byte) (*store.ManagedAgent, error) {
	if !s.Cfg.OSSConfigured() {
		return nil, fmt.Errorf("未配置 OSS")
	}
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		if a == nil && err == nil {
			return nil, fmt.Errorf("agent not found")
		}
		return nil, err
	}
	if len(raw) > 8<<20 {
		return nil, fmt.Errorf("图片过大（上限 8MB）")
	}
	jpg, err := CompressAvatarImage(raw, avatarMaxEdge)
	if err != nil {
		return nil, err
	}
	objName := fmt.Sprintf("agent-%d-%d.jpg", agentID, time.Now().Unix())
	prefix := strings.Trim(s.Cfg.OSSPrefix, "/")
	key := objName
	if prefix != "" {
		key = prefix + "/" + objName
	}
	client, err := oss.New(s.Cfg.OSSEndpoint, s.Cfg.OSSAccessKeyID, s.Cfg.OSSAccessKeySecret)
	if err != nil {
		return nil, fmt.Errorf("oss client: %w", err)
	}
	bucket, err := client.Bucket(s.Cfg.OSSBucket)
	if err != nil {
		return nil, fmt.Errorf("oss bucket: %w", err)
	}
	if err := bucket.PutObject(key, bytes.NewReader(jpg), oss.ContentType("image/jpeg")); err != nil {
		return nil, fmt.Errorf("oss upload: %w", err)
	}
	url := BuildAvatarObjectURL(s.Cfg.OSSPublicBase, s.Cfg.OSSPrefix, objName)
	if err := s.Store.SetManagedAgentAvatarURL(ctx, agentID, url); err != nil {
		return nil, err
	}
	return s.Store.GetManagedAgent(ctx, agentID)
}

// EnsureBarkAvatarURL 返回 Bark 可用的公网头像。已是 http(s) 则直接用；本地相对路径上传 OSS 一次并回写。
func (s *Service) EnsureBarkAvatarURL(ctx context.Context, agentID int64) string {
	if s == nil || agentID <= 0 {
		return ""
	}
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		return ""
	}
	raw := strings.TrimSpace(a.AvatarURL)
	if strings.HasPrefix(raw, "https://") || strings.HasPrefix(raw, "http://") {
		return raw
	}
	if raw == "" || !s.Cfg.OSSConfigured() {
		return ""
	}
	path := localAvatarPath(raw)
	if path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return ""
	}
	updated, err := s.UploadAgentAvatar(ctx, agentID, data)
	if err != nil || updated == nil {
		return ""
	}
	return strings.TrimSpace(updated.AvatarURL)
}

// localAvatarPath 把 /talent-avatars/xx.jpg 解析到 web/public，拒绝目录穿越。
func localAvatarPath(urlPath string) string {
	rel := strings.TrimPrefix(strings.TrimSpace(urlPath), "/")
	if rel == "" || strings.Contains(rel, "..") {
		return ""
	}
	for _, root := range []string{
		filepath.Join("..", "web", "public"),
		filepath.Join("web", "public"),
	} {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// ClearAgentAvatar 清空头像（展示默认图）。
func (s *Service) ClearAgentAvatar(ctx context.Context, agentID int64) (*store.ManagedAgent, error) {
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil {
		if a == nil && err == nil {
			return nil, fmt.Errorf("agent not found")
		}
		return nil, err
	}
	if err := s.Store.SetManagedAgentAvatarURL(ctx, agentID, ""); err != nil {
		return nil, err
	}
	return s.Store.GetManagedAgent(ctx, agentID)
}
