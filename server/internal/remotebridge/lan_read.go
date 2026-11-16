package remotebridge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"atolla/server/internal/agent"
	"atolla/server/internal/store"
)

const (
	lanDefaultMessageLimit = 20
	lanMaxMessageLimit     = 200
)

// ReadMobileSnapshot produces mobile-compatible data directly from this Mac.
// It is intentionally independent of the cloud mirror and only exposes a
// fixed allow-list of resources, rather than turning LAN into a proxy for the
// desktop administration API.
func (b *Bridge) ReadMobileSnapshot(ctx context.Context, resource string, query url.Values) (any, error) {
	if b == nil || b.Store == nil || b.Config == nil {
		return nil, fmt.Errorf("LAN read source is unavailable")
	}
	resource = strings.Trim(strings.TrimSpace(resource), "/")
	switch resource {
	case "instances":
		return b.readInstances(), nil
	case "agents":
		if err := b.requireLocalInstance(query); err != nil {
			return nil, err
		}
		agents, err := b.readAgents(ctx)
		if err != nil {
			return nil, err
		}
		return map[string]any{"agents": agents}, nil
	case "tasks":
		if err := b.requireLocalInstance(query); err != nil {
			return nil, err
		}
		agentID, err := lanAgentID(query)
		if err != nil {
			return nil, err
		}
		tasks, err := b.readTasks(ctx, agentID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"tasks": tasks}, nil
	case "messages":
		if err := b.requireLocalInstance(query); err != nil {
			return nil, err
		}
		agentID, err := lanAgentID(query)
		if err != nil {
			return nil, err
		}
		return b.readMessages(ctx, agentID, query.Get("before_id"), lanMessageLimit(query.Get("limit")))
	case "permissions":
		if err := b.requireLocalInstance(query); err != nil {
			return nil, err
		}
		return b.readPermissions(ctx, query.Get("agent_id"))
	default:
		if strings.HasPrefix(resource, "actions/") {
			if err := b.requireLocalInstance(query); err != nil {
				return nil, err
			}
			return b.readOnlyAction(ctx, strings.TrimPrefix(resource, "actions/"), query)
		}
		return nil, fmt.Errorf("unsupported LAN read resource")
	}
}

// readOnlyAction exposes existing local read handlers through the read facade.
// The explicit allow-list prevents a GET URL from invoking a state-changing
// registry action when future bridge actions are added.
func (b *Bridge) readOnlyAction(ctx context.Context, action string, query url.Values) (any, error) {
	allowed := map[string]struct{}{
		"agent.task_queue.list":    {},
		"agent.task_plan.active":   {},
		"agent.settings.get":       {},
		"agent.skills.list":        {},
		"agent.skills.store":       {},
		"agent.legacy_mounts.list": {},
		"engines.usage.get":        {},
		"notify.prefs.get":         {},
		"jevos.settings.get":       {},
	}
	if _, ok := allowed[action]; !ok {
		return nil, fmt.Errorf("unsupported LAN read action")
	}
	payload := map[string]any{}
	for _, key := range []string{"agent_id", "q", "category", "risk", "fresh", "force"} {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			payload[key] = value
		}
	}
	return b.ExecuteAction(ctx, action, payload)
}

func (b *Bridge) readInstances() map[string]any {
	cfg := b.Config.Get()
	host := CollectHostMetrics()
	hostPayload := map[string]any{
		"os":         host.OS,
		"ip":         host.IP,
		"uptime_sec": host.UptimeSec,
		"cpu_pct":    host.CPUPct,
		"mem_pct":    host.MemPct,
		"disk_pct":   host.DiskPct,
	}
	if host.TempC != nil {
		hostPayload["temp_c"] = *host.TempC
	}
	// The LAN server only represents its own Mac. "online" means the signed
	// request reached the process, not that the cloud relay is registered.
	return map[string]any{"instances": []map[string]any{{
		"instance_id":         cfg.InstanceID,
		"display_name":        cfg.DisplayName,
		"last_heartbeat_at":   time.Now().UnixMilli(),
		"status":              "online",
		"registry_version":    RegistryVersion,
		"actions":             RegisteredActions(),
		"password_expires_at": nil,
		"has_password":        false,
		"host":                hostPayload,
	}}}
}

func (b *Bridge) requireLocalInstance(query url.Values) error {
	want := strings.TrimSpace(query.Get("instance_id"))
	if want == "" || want != b.Config.Get().InstanceID {
		return fmt.Errorf("local instance not found")
	}
	return nil
}

func lanAgentID(query url.Values) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(query.Get("agent_id")), 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid agent_id")
	}
	return id, nil
}

func lanMessageLimit(raw string) int {
	if raw == "" {
		return lanDefaultMessageLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return lanDefaultMessageLimit
	}
	if n > lanMaxMessageLimit {
		return lanMaxMessageLimit
	}
	return n
}

func (b *Bridge) readAgents(ctx context.Context) ([]map[string]any, error) {
	agents, err := b.Store.ListManagedAgents(ctx)
	if err != nil {
		return nil, err
	}
	folderNames := map[int64]string{}
	if folders, folderErr := b.Store.ListAgentFolders(ctx); folderErr == nil {
		for _, folder := range folders {
			folderNames[folder.ID] = folder.Name
		}
	}
	plans := b.activeTaskPlans(ctx)
	rows := make([]map[string]any, 0, len(agents))
	for _, managed := range agents {
		folderName := folderNames[managed.FolderID]
		usage := b.agentMirrorUsage(ctx, managed)
		live, _ := GetAgentLive(managed.ID)
		rows = append(rows, map[string]any{
			"agent_id":     strconv.FormatInt(managed.ID, 10),
			"display_name": managed.Name,
			"engine":       managed.Engine,
			"status":       managed.Status,
			"payload":      buildAgentMirrorPayloadEx(managed, folderName, usage, live, plans[strconv.FormatInt(managed.ID, 10)]),
			"synced_at":    time.Now().UnixMilli(),
		})
	}
	return rows, nil
}

func (b *Bridge) activeTaskPlans(ctx context.Context) map[string]map[string]any {
	plans := map[string]map[string]any{}
	tasks, err := b.Store.AgentTasks(ctx, "managed", "")
	if err != nil {
		return plans
	}
	for _, task := range tasks {
		id := strings.TrimSpace(task.AgentID)
		if id == "" || plans[id] != nil {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(task.Status)) {
		case "running", "waiting", "paused":
			plans[id] = buildTaskPlanMirror(task)
		}
	}
	return plans
}

func (b *Bridge) agentMirrorUsage(ctx context.Context, managed store.ManagedAgent) agentMirrorUsage {
	usage := agentMirrorUsage{}
	if managed.ConversationID <= 0 {
		return usage
	}
	meta, err := b.Store.GetConversationEngineMeta(ctx, managed.ConversationID)
	if err != nil {
		return usage
	}
	if strings.EqualFold(strings.TrimSpace(meta.ContextSource), "unavailable") {
		usage.ContextSource = "unavailable"
		return usage
	}
	usage.UsedTokens = meta.UsedTokens
	usage.WindowTokens = meta.WindowTokens
	usage.ContextSource = strings.TrimSpace(meta.ContextSource)
	usage.ContextUpdatedAt = meta.ContextUpdatedAt
	if usage.UsedTokens > 0 || usage.ContextSource != "" {
		if usage.WindowTokens <= 0 {
			usage.WindowTokens = managed.ContextWindowTokens
		}
		if usage.WindowTokens > 0 && usage.UsedTokens > usage.WindowTokens {
			usage.Anomaly = fmt.Sprintf("current_context_exceeds_window: used=%d window=%d", usage.UsedTokens, usage.WindowTokens)
			usage.UsedTokens = usage.WindowTokens
		}
		if usage.ContextSource == "" && usage.UsedTokens > 0 {
			usage.ContextSource = "cached"
		}
	}
	usage.Estimated = agent.InferEstimated(managed.Engine, usage.ContextSource)
	usage.UsedPercent = agent.PercentOf(usage.UsedTokens, usage.WindowTokens)
	return usage
}

func (b *Bridge) readTasks(ctx context.Context, agentID int64) ([]map[string]any, error) {
	tasks, err := b.Store.AgentTasks(ctx, "", strconv.FormatInt(agentID, 10))
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(tasks))
	for _, task := range tasks {
		rows = append(rows, map[string]any{
			"agent_id":  strconv.FormatInt(agentID, 10),
			"task_id":   task.TaskID,
			"status":    task.Status,
			"payload":   buildTaskPlanMirror(task),
			"synced_at": time.Now().UnixMilli(),
		})
	}
	return rows, nil
}

func (b *Bridge) readMessages(ctx context.Context, agentID int64, beforeRaw string, limit int) (map[string]any, error) {
	managed, err := b.Store.GetManagedAgent(ctx, agentID)
	if err != nil || managed == nil {
		return nil, fmt.Errorf("agent not found")
	}
	if managed.ConversationID <= 0 {
		return map[string]any{"messages": []any{}, "limit": limit, "has_more": false}, nil
	}
	beforeID, _ := strconv.ParseInt(strings.TrimSpace(beforeRaw), 10, 64)
	messages, _, hasMore, err := b.Store.MessagesPage(ctx, managed.ConversationID, beforeID, limit)
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(messages))
	for _, message := range messages {
		payload := lanMessagePayload(message.MetaJSON, message.Status, message.Role, message.Content)
		content := message.Content
		if command, ok := payload["command"].(string); ok && strings.TrimSpace(command) != "" {
			content = command
		}
		rows = append(rows, map[string]any{
			"message_id": strconv.FormatInt(message.ID, 10),
			"agent_id":   strconv.FormatInt(agentID, 10),
			"role":       message.Role,
			"content":    content,
			"created_at": message.CreatedAt.UnixMilli(),
			"payload":    payload,
			"synced_at":  time.Now().UnixMilli(),
		})
	}
	return map[string]any{"messages": rows, "limit": limit, "has_more": hasMore}, nil
}

func lanMessagePayload(metaJSON, status, role, content string) map[string]any {
	payload := map[string]any{}
	if strings.TrimSpace(metaJSON) != "" {
		var meta map[string]any
		if json.Unmarshal([]byte(metaJSON), &meta) == nil {
			for _, key := range []string{"attachments", "callee_id", "callee_name", "caller_name"} {
				if value, ok := meta[key]; ok {
					payload[key] = value
				}
			}
		}
	}
	if strings.TrimSpace(status) != "" {
		payload["status"] = status
	}
	if role == "command" && strings.HasPrefix(strings.TrimSpace(content), "{") {
		var command map[string]any
		if json.Unmarshal([]byte(content), &command) == nil {
			for _, key := range []string{"command", "decision", "risk", "meaning", "by", "note"} {
				if value, ok := command[key]; ok {
					payload[key] = value
				}
			}
		}
	}
	if payload["decision"] == nil && status == "denied" {
		payload["decision"] = "deny"
	}
	return payload
}

func (b *Bridge) readPermissions(ctx context.Context, rawAgentID string) (map[string]any, error) {
	if b.Perms == nil {
		return map[string]any{"items": []any{}}, nil
	}
	filterAgentID := strings.TrimSpace(rawAgentID)
	items := make([]map[string]any, 0)
	for _, pending := range b.Perms.Pending(0) {
		agentID, err := b.Store.ConversationAgentID(ctx, pending.ConvID)
		if err != nil || agentID <= 0 {
			continue
		}
		if filterAgentID != "" && filterAgentID != strconv.FormatInt(agentID, 10) {
			continue
		}
		items = append(items, map[string]any{
			"request_id":      pending.ID,
			"agent_id":        strconv.FormatInt(agentID, 10),
			"conversation_id": pending.ConvID,
			"tool_name":       pending.ToolName,
			"summary":         pending.Summary,
			"note":            pending.Note,
			"meaning":         pending.Meaning,
			"risk":            pending.Risk,
			"created_at":      pending.CreatedAt,
			"deadline":        pending.Deadline,
			"synced_at":       time.Now().UnixMilli(),
		})
	}
	return map[string]any{"items": items}, nil
}
