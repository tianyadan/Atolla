package remotebridge

import (
	"fmt"
	"strings"

	"atolla/server/internal/store"
)

// handleAgentCreate creates a managed agent from mobile (name / engine / jelly_color).
func handleAgentCreate(ec *ExecContext) (any, error) {
	if ec.Store == nil {
		return nil, fmt.Errorf("store not configured")
	}
	name, _ := ec.Payload["name"].(string)
	name = strings.TrimSpace(name)
	if name == "" {
		name = "未命名员工"
	}
	engine, _ := ec.Payload["engine"].(string)
	engine = strings.ToLower(strings.TrimSpace(engine))
	if !store.ValidEngine(engine) {
		return nil, fmt.Errorf("engine must be claude|codex|agent")
	}

	var jellyPtr *string
	if raw, ok := ec.Payload["jelly_color"]; ok {
		s, _ := raw.(string)
		norm := store.NormalizeJellyColor(s)
		if norm == "" {
			return nil, store.ErrInvalidJellyColor
		}
		jellyPtr = &norm
	}

	in := store.ManagedAgentInput{
		Name:       name,
		Engine:     engine,
		JellyColor: jellyPtr,
	}
	id, err := ec.Store.CreateManagedAgent(ec.Context, in)
	if err != nil {
		return nil, err
	}
	a, err := ec.Store.GetManagedAgent(ec.Context, id)
	if err != nil || a == nil {
		return nil, fmt.Errorf("reload agent failed")
	}
	_ = pushAgentsAfterPolicy(ec)
	return map[string]any{
		"agent_id":     fmt.Sprintf("%d", a.ID),
		"display_name": a.Name,
		"engine":       a.Engine,
		"jelly_color":  a.JellyColor,
		"status":       a.Status,
	}, nil
}
