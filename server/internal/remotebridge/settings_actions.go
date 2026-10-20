package remotebridge

import (
	"fmt"
	"strconv"
	"strings"

	"atolla/server/internal/store"
)

// settingsPublic shapes agent settings for mobile (engine read-only).
func settingsPublic(a *store.ManagedAgent, skillCount int) map[string]any {
	return map[string]any{
		"agent_id":     strconv.FormatInt(a.ID, 10),
		"name":         a.Name,
		"engine":       a.Engine,
		"rules_prompt": a.RulesPrompt,
		"jelly_color":  a.JellyColor,
		"skill_count":  skillCount,
	}
}

// handleAgentSettingsGet returns name/engine/rules for mobile settings sheet.
func handleAgentSettingsGet(ec *ExecContext) (any, error) {
	if ec.Store == nil {
		return nil, fmt.Errorf("store not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	a, err := ec.Store.GetManagedAgent(ec.Context, agentID)
	if err != nil || a == nil {
		if a == nil && err == nil {
			return nil, fmt.Errorf("agent not found")
		}
		return nil, err
	}
	counts, _ := ec.Store.CountInstalledSkillsMap(ec.Context)
	return settingsPublic(a, counts[a.ID]), nil
}

// handleAgentSettingsUpdate saves rules_prompt only; keeps policy fields from DB.
func handleAgentSettingsUpdate(ec *ExecContext) (any, error) {
	if ec.Store == nil {
		return nil, fmt.Errorf("store not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	raw, ok := ec.Payload["rules_prompt"]
	if !ok {
		return nil, fmt.Errorf("rules_prompt required")
	}
	rules, _ := raw.(string)

	a, err := ec.Store.GetManagedAgent(ec.Context, agentID)
	if err != nil || a == nil {
		if a == nil && err == nil {
			return nil, fmt.Errorf("agent not found")
		}
		return nil, err
	}
	aw, an, ar, ab := a.AllowWrite, a.AllowNetwork, a.AllowRm, a.AllowBrowser
	ws, se, cron, label := a.WorkspacePath, a.ScheduleEnabled, a.ScheduleCron, a.ScheduleLabel
	in := store.ManagedAgentInput{
		Name:            a.Name,
		BinPath:         a.BinPath,
		RulesPrompt:     rules,
		AllowWrite:      &aw,
		AllowNetwork:    &an,
		AllowRm:         &ar,
		AllowBrowser:    &ab,
		WorkspacePath:   &ws,
		ScheduleEnabled: &se,
		ScheduleCron:    &cron,
		ScheduleLabel:   &label,
	}
	if err := ec.Store.UpdateManagedAgent(ec.Context, agentID, in); err != nil {
		return nil, err
	}
	updated, err := ec.Store.GetManagedAgent(ec.Context, agentID)
	if err != nil || updated == nil {
		return nil, fmt.Errorf("reload agent failed")
	}
	counts, _ := ec.Store.CountInstalledSkillsMap(ec.Context)
	_ = pushAgentsAfterPolicy(ec)
	return settingsPublic(updated, counts[updated.ID]), nil
}

// handleAgentSkillsList returns catalog merged with install state.
func handleAgentSkillsList(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	items, err := ec.Runtime.ListAgentSkills(ec.Context, agentID)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []store.AgentSkillView{}
	}
	return map[string]any{"skills": items}, nil
}

// handleAgentSkillsStore returns marketplace catalog (optional q/category).
func handleAgentSkillsStore(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	q, _ := ec.Payload["q"].(string)
	category, _ := ec.Payload["category"].(string)
	risk, _ := ec.Payload["risk"].(string)
	items, err := ec.Runtime.ListSkillStore(ec.Context, q, category, risk)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []store.SkillCatalogItem{}
	}
	return map[string]any{"skills": items}, nil
}

// payloadSkillID reads skill_id from command payload.
func payloadSkillID(payload map[string]interface{}) (string, error) {
	raw, _ := payload["skill_id"].(string)
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("skill_id required")
	}
	return raw, nil
}

// payloadStringSlice reads optional string array from payload.
func payloadStringSlice(payload map[string]interface{}, key string) []string {
	raw, ok := payload[key]
	if !ok || raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case []string:
		return v
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, x := range v {
			s, _ := x.(string)
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

// handleAgentSkillsInstall installs a catalog skill onto the agent.
func handleAgentSkillsInstall(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	skillID, err := payloadSkillID(ec.Payload)
	if err != nil {
		return nil, err
	}
	caps := payloadStringSlice(ec.Payload, "capabilities")
	items, err := ec.Runtime.InstallAgentSkill(ec.Context, agentID, skillID, "mobile", caps)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []store.AgentSkillView{}
	}
	_ = pushAgentsAfterPolicy(ec)
	return map[string]any{"skills": items}, nil
}

// handleAgentSkillsUninstall removes an installed skill.
func handleAgentSkillsUninstall(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	skillID, err := payloadSkillID(ec.Payload)
	if err != nil {
		return nil, err
	}
	items, err := ec.Runtime.UninstallAgentSkill(ec.Context, agentID, skillID)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []store.AgentSkillView{}
	}
	_ = pushAgentsAfterPolicy(ec)
	return map[string]any{"skills": items}, nil
}

// handleAgentLegacyMountsList returns read-only inherited memory mounts.
func handleAgentLegacyMountsList(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("agent runtime not configured")
	}
	agentID, err := payloadAgentID(ec.Payload)
	if err != nil {
		return nil, err
	}
	items, err := ec.Runtime.ListAgentLegacyMounts(ec.Context, agentID)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []store.AgentLegacyMemoryMount{}
	}
	return map[string]any{"items": items, "max": 5}, nil
}
