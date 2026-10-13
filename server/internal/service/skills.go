package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"atolla/server/internal/store"
)

// ListSkillStore returns the marketplace catalog.
func (s *Service) ListSkillStore(ctx context.Context, q, category, risk string) ([]store.SkillCatalogItem, error) {
	items, err := s.Store.ListSkillCatalog(ctx, false)
	if err != nil {
		return nil, err
	}
	q = strings.ToLower(strings.TrimSpace(q))
	category = strings.TrimSpace(category)
	risk = strings.TrimSpace(risk)
	if q == "" && category == "" && risk == "" {
		return items, nil
	}
	var out []store.SkillCatalogItem
	for _, it := range items {
		if category != "" && !strings.EqualFold(it.Category, category) {
			continue
		}
		if risk != "" && !strings.EqualFold(it.Risk, risk) {
			continue
		}
		if q != "" {
			blob := strings.ToLower(it.Name + " " + it.Summary + " " + it.Description + " " + it.ID)
			if !strings.Contains(blob, q) {
				continue
			}
		}
		out = append(out, it)
	}
	return out, nil
}

// GetSkillStoreItem returns one catalog skill.
func (s *Service) GetSkillStoreItem(ctx context.Context, id string) (store.SkillCatalogItem, error) {
	return s.Store.GetSkillCatalog(ctx, id)
}

// ListAgentSkills returns catalog merged with install state.
func (s *Service) ListAgentSkills(ctx context.Context, agentID int64) ([]store.AgentSkillView, error) {
	if _, err := s.Store.GetManagedAgent(ctx, agentID); err != nil {
		return nil, err
	}
	return s.Store.ListAgentSkills(ctx, agentID)
}

// InstallAgentSkill installs a skill onto an agent and syncs engine allow_* flags.
func (s *Service) InstallAgentSkill(ctx context.Context, agentID int64, skillID, installedBy string, caps []string) ([]store.AgentSkillView, error) {
	if _, err := s.Store.GetManagedAgent(ctx, agentID); err != nil {
		return nil, err
	}
	if skillID == "atolla.browser" {
		if _, err := s.EnsureBrowserUse(ctx); err != nil {
			return nil, fmt.Errorf("browser-use 依赖未就绪: %w", err)
		}
	}
	if err := s.Store.InstallAgentSkill(ctx, agentID, skillID, installedBy, caps); err != nil {
		return nil, err
	}
	if err := s.syncAgentEngineFlagsFromSkills(ctx, agentID); err != nil {
		return nil, err
	}
	return s.Store.ListAgentSkills(ctx, agentID)
}

// UpdateAgentSkill patches install enabled/capabilities.
func (s *Service) UpdateAgentSkill(ctx context.Context, agentID int64, skillID string, enabled *bool, caps []string) ([]store.AgentSkillView, error) {
	if err := s.Store.UpdateAgentSkillInstall(ctx, agentID, skillID, enabled, caps); err != nil {
		return nil, err
	}
	if err := s.syncAgentEngineFlagsFromSkills(ctx, agentID); err != nil {
		return nil, err
	}
	return s.Store.ListAgentSkills(ctx, agentID)
}

// UninstallAgentSkill removes an install.
func (s *Service) UninstallAgentSkill(ctx context.Context, agentID int64, skillID string) ([]store.AgentSkillView, error) {
	if err := s.Store.UninstallAgentSkill(ctx, agentID, skillID); err != nil {
		return nil, err
	}
	if skillID == skillDatabaseID {
		_ = s.Store.DeleteAllDBSources(ctx, agentID)
	}
	if skillID == skillServerControlID {
		_ = s.Store.DeleteAllServerSources(ctx, agentID)
	}
	if err := s.syncAgentEngineFlagsFromSkills(ctx, agentID); err != nil {
		return nil, err
	}
	return s.Store.ListAgentSkills(ctx, agentID)
}

// PublishCustomSkill registers a local custom skill in the store.
func (s *Service) PublishCustomSkill(ctx context.Context, item store.SkillCatalogItem) (store.SkillCatalogItem, error) {
	item.Name = strings.TrimSpace(item.Name)
	item.Summary = strings.TrimSpace(item.Summary)
	if item.Name == "" {
		return item, fmt.Errorf("name required")
	}
	if item.Summary == "" {
		item.Summary = item.Name
	}
	if strings.TrimSpace(item.Description) == "" {
		item.Description = item.Summary
	}
	return s.Store.CreateCustomSkill(ctx, item)
}

// BuildAgentSystemPromptWithSkills appends compact installed-skill + DB source blocks.
func (s *Service) BuildAgentSystemPromptWithSkills(ctx context.Context, a *store.ManagedAgent) string {
	base := BuildAgentSystemPrompt(a)
	if a == nil || s.Store == nil {
		return base
	}
	skills, err := s.Store.ListInstalledAgentSkills(ctx, a.ID)
	if err != nil || len(skills) == 0 {
		return base
	}
	parts := []string{base}
	if block := store.FormatInstalledSkillsPrompt(skills); block != "" {
		parts = append(parts, block)
	}
	for _, sk := range skills {
		switch sk.ID {
		case skillDatabaseID:
			parts = append(parts, s.compactDatabaseSkillPrompt(ctx, a.ID))
		case skillServerControlID:
			parts = append(parts, s.compactServerSkillPrompt(ctx, a.ID))
		}
	}
	return strings.Join(parts, "\n\n")
}

func (s *Service) syncAgentEngineFlagsFromSkills(ctx context.Context, agentID int64) error {
	all, err := s.Store.ListAgentSkills(ctx, agentID)
	if err != nil {
		return err
	}
	a, err := s.Store.GetManagedAgent(ctx, agentID)
	if err != nil {
		return err
	}
	beforeW, beforeN, beforeB := a.AllowWrite, a.AllowNetwork, a.AllowBrowser
	store.SyncEngineFlagsFromSkills(all, a)
	if a.AllowWrite == beforeW && a.AllowNetwork == beforeN && a.AllowBrowser == beforeB {
		return nil
	}
	// RulesPrompt 必须带回，否则 UpdateManagedAgent 会把规则写成空串。
	in := store.ManagedAgentInput{
		RulesPrompt:  a.RulesPrompt,
		AllowWrite:   &a.AllowWrite,
		AllowNetwork: &a.AllowNetwork,
		AllowBrowser: &a.AllowBrowser,
	}
	return s.Store.UpdateManagedAgent(ctx, agentID, in)
}

// ErrSkillNotFound wraps missing skill/install.
func IsNotFound(err error) bool {
	return err == sql.ErrNoRows || (err != nil && strings.Contains(err.Error(), "no rows"))
}
