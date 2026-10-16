package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"

	"atolla/server/internal/agent"
)

const (
	chatImageMaxRaw   = 8 << 20 // 上传原始上限
	chatImageMaxEdge  = 1600
	chatImageMaxCount = 6
)

// ChatAttachment is a persisted chat image reference.
type ChatAttachment struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	Mime     string `json:"mime"`
	Name     string `json:"name"`
	LocalPath string `json:"-"`
}

// ChatImageDir returns the on-disk directory for chat images.
func (s *Service) ChatImageDir() string {
	root := strings.TrimSpace(s.Cfg.WorkspaceRoot)
	if root == "" {
		root = os.TempDir()
	}
	return filepath.Join(root, ".atolla", "chat-images")
}

func newChatImageID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// SaveChatImage compresses and stores an uploaded image; returns public attachment meta.
func (s *Service) SaveChatImage(ctx context.Context, raw []byte, filename string) (*ChatAttachment, error) {
	_ = ctx
	if len(raw) == 0 {
		return nil, fmt.Errorf("empty image")
	}
	if len(raw) > chatImageMaxRaw {
		return nil, fmt.Errorf("图片过大（上限 8MB）")
	}
	jpg, err := CompressAvatarImage(raw, chatImageMaxEdge)
	if err != nil {
		return nil, err
	}
	id := newChatImageID()
	dir := s.ChatImageDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	localName := id + ".jpg"
	localPath := filepath.Join(dir, localName)
	if err := os.WriteFile(localPath, jpg, 0o644); err != nil {
		return nil, err
	}
	url := "/api/chat-images/" + localName
	// 可选同步 OSS，便于公网加速展示
	if s.Cfg.OSSConfigured() {
		if ossURL, oerr := s.uploadChatImageOSS(id, jpg); oerr == nil && ossURL != "" {
			url = ossURL
		}
	}
	name := strings.TrimSpace(filename)
	if name == "" {
		name = "paste.jpg"
	}
	return &ChatAttachment{
		ID: id, URL: url, Mime: "image/jpeg", Name: name, LocalPath: localPath,
	}, nil
}

func (s *Service) uploadChatImageOSS(id string, jpg []byte) (string, error) {
	objName := fmt.Sprintf("chat-%s-%d.jpg", id, time.Now().Unix())
	prefix := strings.Trim(s.Cfg.OSSPrefix, "/")
	sub := "chat"
	if prefix != "" {
		sub = prefix + "/chat"
	}
	key := sub + "/" + objName
	client, err := oss.New(s.Cfg.OSSEndpoint, s.Cfg.OSSAccessKeyID, s.Cfg.OSSAccessKeySecret)
	if err != nil {
		return "", err
	}
	bucket, err := client.Bucket(s.Cfg.OSSBucket)
	if err != nil {
		return "", err
	}
	if err := bucket.PutObject(key, bytes.NewReader(jpg), oss.ContentType("image/jpeg")); err != nil {
		return "", err
	}
	return BuildAvatarObjectURL(s.Cfg.OSSPublicBase, sub, objName), nil
}

// ResolveChatImagePath maps attachment URL/id to local file for engine use.
func (s *Service) ResolveChatImagePath(att ChatAttachment) string {
	if p := strings.TrimSpace(att.LocalPath); p != "" {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	id := strings.TrimSpace(att.ID)
	if id == "" {
		// /api/chat-images/{id}.jpg
		u := att.URL
		if i := strings.LastIndex(u, "/"); i >= 0 {
			id = strings.TrimSuffix(u[i+1:], ".jpg")
		}
	}
	if id == "" {
		return ""
	}
	p := filepath.Join(s.ChatImageDir(), id+".jpg")
	if _, err := os.Stat(p); err == nil {
		return p
	}
	return ""
}

// AttachmentsToAgentImages loads local files for Claude multimodal.
func (s *Service) AttachmentsToAgentImages(atts []ChatAttachment) []agent.ImagePart {
	var out []agent.ImagePart
	for _, a := range atts {
		path := s.ResolveChatImagePath(a)
		if path == "" {
			continue
		}
		mime := a.Mime
		if mime == "" {
			mime = "image/jpeg"
		}
		out = append(out, agent.ImagePart{Mime: mime, Path: path})
	}
	return out
}

// StageAttachmentsInWorkspace copies images into agent cwd for Codex/Cursor path-based reading.
func (s *Service) StageAttachmentsInWorkspace(dir string, atts []ChatAttachment) (paths []string, err error) {
	if len(atts) == 0 {
		return nil, nil
	}
	sub := filepath.Join(dir, ".atolla-chat-images")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		return nil, err
	}
	for i, a := range atts {
		src := s.ResolveChatImagePath(a)
		if src == "" {
			continue
		}
		name := fmt.Sprintf("img-%d-%s.jpg", i+1, a.ID)
		if a.ID == "" {
			name = fmt.Sprintf("img-%d.jpg", i+1)
		}
		dst := filepath.Join(sub, name)
		b, rerr := os.ReadFile(src)
		if rerr != nil {
			continue
		}
		if werr := os.WriteFile(dst, b, 0o644); werr != nil {
			continue
		}
		paths = append(paths, dst)
	}
	return paths, nil
}

// AttachmentsMetaJSON stores display metadata on user messages.
func AttachmentsMetaJSON(atts []ChatAttachment) string {
	if len(atts) == 0 {
		return ""
	}
	type item struct {
		ID   string `json:"id"`
		URL  string `json:"url"`
		Mime string `json:"mime"`
		Name string `json:"name"`
	}
	list := make([]item, 0, len(atts))
	for _, a := range atts {
		list = append(list, item{ID: a.ID, URL: a.URL, Mime: a.Mime, Name: a.Name})
	}
	b, _ := json.Marshal(map[string]any{"attachments": list})
	return string(b)
}

// NormalizeChatAttachments caps count and drops empties.
func NormalizeChatAttachments(in []ChatAttachment) []ChatAttachment {
	var out []ChatAttachment
	for _, a := range in {
		if strings.TrimSpace(a.URL) == "" && strings.TrimSpace(a.ID) == "" {
			continue
		}
		out = append(out, a)
		if len(out) >= chatImageMaxCount {
			break
		}
	}
	return out
}

const chatImageLifecycleRuleID = "atolla-chat-images-7d"

// chatImageOSSPrefix returns the object key prefix used for chat uploads.
func (s *Service) chatImageOSSPrefix() string {
	prefix := strings.Trim(s.Cfg.OSSPrefix, "/")
	if prefix != "" {
		return prefix + "/chat/"
	}
	return "chat/"
}

// EnsureChatImageOSSLifecycle merges a 7-day expiration rule for chat/ prefix.
// Best-effort: logs and returns on permission / API errors without failing boot.
func (s *Service) EnsureChatImageOSSLifecycle() {
	if s == nil || !s.Cfg.OSSConfigured() {
		return
	}
	client, err := oss.New(s.Cfg.OSSEndpoint, s.Cfg.OSSAccessKeyID, s.Cfg.OSSAccessKeySecret)
	if err != nil {
		log.Printf("chat-image OSS lifecycle: client: %v", err)
		return
	}
	prefix := s.chatImageOSSPrefix()
	days := 7
	rule := oss.LifecycleRule{
		ID:     chatImageLifecycleRuleID,
		Prefix: prefix,
		Status: "Enabled",
		Expiration: &oss.LifecycleExpiration{Days: days},
	}
	var rules []oss.LifecycleRule
	existing, gerr := client.GetBucketLifecycle(s.Cfg.OSSBucket)
	if gerr == nil {
		for _, r := range existing.Rules {
			if r.ID == chatImageLifecycleRuleID {
				continue // replace ours
			}
			rules = append(rules, r)
		}
	}
	rules = append(rules, rule)
	if err := client.SetBucketLifecycle(s.Cfg.OSSBucket, rules); err != nil {
		log.Printf("chat-image OSS lifecycle: set: %v", err)
		return
	}
	log.Printf("chat-image OSS lifecycle ensured id=%s prefix=%s days=%d", chatImageLifecycleRuleID, prefix, days)
}

// PurgeLocalChatImagesOlderThan deletes local chat image files older than cutoff.
func (s *Service) PurgeLocalChatImagesOlderThan(cutoff time.Time) (int, error) {
	dir := s.ChatImageDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	n := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		info, ierr := e.Info()
		if ierr != nil {
			continue
		}
		if info.ModTime().After(cutoff) {
			continue
		}
		path := filepath.Join(dir, name)
		if err := os.Remove(path); err != nil {
			continue
		}
		n++
	}
	return n, nil
}
