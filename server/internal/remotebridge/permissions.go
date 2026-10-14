package remotebridge

import (
	"context"
	"log"
	"strconv"
	"strings"
	"time"

	"atolla/server/internal/permission"
)

// SetPerms wires the permission Hub so the bridge can push pending cards to the relay.
func (b *Bridge) SetPerms(h *permission.Hub) {
	b.Perms = h
}

// startPermissionSync pushes current pending cards and mirrors Hub events to the relay.
func (b *Bridge) startPermissionSync(ctx context.Context) {
	if b.Perms == nil || b.Store == nil || b.Config == nil || !b.Config.Ready() {
		return
	}
	client := b.newClient(b.Config.Get())
	_ = b.pushAllPendingPermissions(ctx, client)

	ch := b.Perms.Subscribe()
	go func() {
		defer b.Perms.Unsubscribe(ch)
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-ch:
				if !ok {
					return
				}
				cfg := b.Config.Get()
				cli := b.newClient(cfg)
				switch ev.Kind {
				case "request":
					// Meaning/risk 常在 Register 返回后才写入；短暂延迟再读 Pending。
					convID := int64(0)
					if ev.Req != nil {
						convID = ev.Req.ConvID
					}
					reqID := ""
					if ev.Req != nil {
						reqID = ev.Req.ID
					}
					go func(cID int64, id string, c *RelayClient) {
						time.Sleep(80 * time.Millisecond)
						if ctx.Err() != nil {
							return
						}
						// 若已裁决则不要再推到手机
						if id != "" && b.Perms != nil {
							still := false
							for _, p := range b.Perms.Pending(cID) {
								if p.ID == id {
									still = true
									break
								}
							}
							if !still {
								return
							}
						}
						_ = b.pushPendingForConv(ctx, c, cID)
					}(convID, reqID, cli)
				case "resolved":
					if ev.Res == nil || strings.TrimSpace(ev.Res.ID) == "" {
						continue
					}
					if err := cli.PostPermissionsResolved(ctx, []string{ev.Res.ID}); err != nil {
						log.Printf("remotebridge permissions resolved: %v", err)
						b.setErr(err.Error())
					}
				}
			}
		}
	}()
}

// pushAllPendingPermissions upserts every Hub pending card with agent_id resolved.
func (b *Bridge) pushAllPendingPermissions(ctx context.Context, client *RelayClient) error {
	if b.Perms == nil {
		return nil
	}
	return b.pushPendingList(ctx, client, b.Perms.Pending(0))
}

func (b *Bridge) pushPendingForConv(ctx context.Context, client *RelayClient, convID int64) error {
	if b.Perms == nil {
		return nil
	}
	return b.pushPendingList(ctx, client, b.Perms.Pending(convID))
}

func (b *Bridge) pushPendingList(ctx context.Context, client *RelayClient, list []permission.Public) error {
	if client == nil || len(list) == 0 {
		return nil
	}
	rows := make([]map[string]any, 0, len(list))
	for _, p := range list {
		agentID, err := b.Store.ConversationAgentID(ctx, p.ConvID)
		if err != nil || agentID <= 0 {
			continue
		}
		rows = append(rows, map[string]any{
			"request_id":      p.ID,
			"agent_id":        strconv.FormatInt(agentID, 10),
			"conversation_id": p.ConvID,
			"tool_name":       p.ToolName,
			"summary":         p.Summary,
			"note":            p.Note,
			"meaning":         p.Meaning,
			"risk":            p.Risk,
			"created_at":      p.CreatedAt,
			"deadline":        p.Deadline,
		})
	}
	if len(rows) == 0 {
		return nil
	}
	if err := client.PostPermissionsSnapshot(ctx, rows); err != nil {
		log.Printf("remotebridge permissions snapshot: %v", err)
		b.setErr(err.Error())
		return err
	}
	return nil
}

// PushPermissionsNow forces a full pending push (tests / recovery).
func (b *Bridge) PushPermissionsNow(ctx context.Context) error {
	if b == nil || b.Config == nil || !b.Config.Ready() {
		return nil
	}
	return b.pushAllPendingPermissions(ctx, b.newClient(b.Config.Get()))
}
