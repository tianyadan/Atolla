package service

import (
	"context"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"atolla/server/internal/store"
)

// 本机选图：从 Codex/Cursor 回合正文识别路径并上传为 chat attachments。

var localImagePathRe = regexp.MustCompile(`(?i)(?:file://)?(/[^\s"'` + "`" + `<>)\]]+\.(?:png|jpe?g|webp|gif|heic|heif))`)

var localImageDeniedSegments = []string{
	".ssh", ".gnupg", ".aws", "keychains", "keys",
}

// EngineSupportsLocalImageAttach Codex / Cursor(agent) 启用本机选图展示。
func EngineSupportsLocalImageAttach(engine string) bool {
	eng := store.RepairEngineName(engine)
	if eng == "cursor" {
		eng = "agent"
	}
	switch eng {
	case "codex", "agent":
		return true
	default:
		return false
	}
}

// ExtractLocalImagePathCandidates 从文本抽出疑似绝对图片路径（未校验存在性）。
func ExtractLocalImagePathCandidates(text string) []string {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	matches := localImagePathRe.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		p := normalizeLocalImagePathCandidate(m[1])
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func normalizeLocalImagePathCandidate(raw string) string {
	p := strings.TrimSpace(raw)
	p = strings.Trim(p, "`\"'")
	if strings.HasPrefix(strings.ToLower(p), "file://") {
		u, err := url.Parse(p)
		if err == nil {
			p = u.Path
		} else {
			p = strings.TrimPrefix(p, "file://")
		}
	}
	p = filepath.Clean(p)
	if !filepath.IsAbs(p) {
		return ""
	}
	return p
}

// pathAllowedForLocalImage 主目录或工作区下，且非敏感目录。
func pathAllowedForLocalImage(absPath, homeDir, workspaceDir string) bool {
	absPath = filepath.Clean(absPath)
	lower := strings.ToLower(absPath)
	for _, seg := range strings.Split(lower, string(filepath.Separator)) {
		for _, deny := range localImageDeniedSegments {
			if seg == deny {
				return false
			}
		}
	}
	under := func(root string) bool {
		root = filepath.Clean(strings.TrimSpace(root))
		if root == "" {
			return false
		}
		rel, err := filepath.Rel(root, absPath)
		if err != nil {
			return false
		}
		return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
	}
	if under(homeDir) || under(workspaceDir) {
		return true
	}
	return false
}

func evalSymlinkRoot(root string) string {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(root); err == nil && resolved != "" {
		return resolved
	}
	return root
}

// ResolveLocalImagePaths 校验白名单 + 文件存在，返回去重后的绝对路径（最多 max）。
func ResolveLocalImagePaths(candidates []string, homeDir, workspaceDir string, max int) []string {
	if max <= 0 {
		max = chatImageMaxCount
	}
	homeDir = evalSymlinkRoot(homeDir)
	workspaceDir = evalSymlinkRoot(workspaceDir)
	seen := map[string]struct{}{}
	out := make([]string, 0, max)
	for _, c := range candidates {
		if len(out) >= max {
			break
		}
		p := normalizeLocalImagePathCandidate(c)
		if p == "" {
			continue
		}
		// 相对路径：相对工作区
		if !filepath.IsAbs(p) && strings.TrimSpace(workspaceDir) != "" {
			p = filepath.Clean(filepath.Join(workspaceDir, p))
		}
		resolved, err := filepath.EvalSymlinks(p)
		if err == nil && resolved != "" {
			p = resolved
		}
		if !pathAllowedForLocalImage(p, homeDir, workspaceDir) {
			continue
		}
		st, err := os.Stat(p)
		if err != nil || st.IsDir() {
			continue
		}
		if st.Size() <= 0 || st.Size() > chatImageMaxRaw {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

// AttachLocalImagesFromText 读取合法本机图并 SaveChatImage。
func (s *Service) AttachLocalImagesFromText(ctx context.Context, engine, workspaceDir, text string) []ChatAttachment {
	if s == nil || !EngineSupportsLocalImageAttach(engine) {
		return nil
	}
	home, _ := os.UserHomeDir()
	cands := ExtractLocalImagePathCandidates(text)
	paths := ResolveLocalImagePaths(cands, home, workspaceDir, chatImageMaxCount)
	if len(paths) == 0 {
		return nil
	}
	out := make([]ChatAttachment, 0, len(paths))
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			log.Printf("local-image: read %s: %v", filepath.Base(p), err)
			continue
		}
		att, err := s.SaveChatImage(ctx, raw, filepath.Base(p))
		if err != nil {
			log.Printf("local-image: save %s: %v", filepath.Base(p), err)
			continue
		}
		if att != nil {
			out = append(out, *att)
		}
	}
	return out
}

// AttachmentsForSSE 转为 SSE/JSON 友好结构。
func AttachmentsForSSE(atts []ChatAttachment) []map[string]string {
	out := make([]map[string]string, 0, len(atts))
	for _, a := range atts {
		out = append(out, map[string]string{
			"id":   a.ID,
			"url":  a.URL,
			"mime": a.Mime,
			"name": a.Name,
		})
	}
	return out
}
