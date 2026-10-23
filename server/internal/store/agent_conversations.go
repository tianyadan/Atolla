package store

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

// AgentConversationSummary 是现代工作台最近对话列表的最小完整视图。
type AgentConversationSummary struct {
	ID             int64     `json:"id"`
	AgentID        int64     `json:"agent_id"`
	AgentName      string    `json:"agent_name"`
	Engine         string    `json:"engine"`
	JellyColor     string    `json:"jelly_color"`
	GroupName      string    `json:"group_name"`
	AgentStatus    string    `json:"agent_status"`
	TaskUnread     bool      `json:"task_unread"`
	TaskUnreadKind string    `json:"task_unread_kind"`
	Title          string    `json:"title"`
	Preview        string    `json:"preview"`
	Pinned         bool      `json:"pinned"`
	Archived       bool      `json:"archived"`
	Active         bool      `json:"active"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// AgentConversationPatch 只更新显式传入的字段，避免部分更新覆盖其他偏好。
type AgentConversationPatch struct {
	Title    *string
	Pinned   *bool
	Archived *bool
}

const agentConversationSelect = `
	SELECT c.id, c.agent_id, a.name, a.engine, IFNULL(a.jelly_color,''),
	       IFNULL(f.name,'未分组'), IFNULL(a.status,'idle'),
	       IFNULL(a.task_unread,0), IFNULL(a.task_unread_kind,''),
	       COALESCE(NULLIF(TRIM(c.title),''), NULLIF(LEFT((
	         SELECT m.content FROM messages m
	         WHERE m.conversation_id=c.id AND m.role='user' AND TRIM(m.content)<>''
	         ORDER BY m.id DESC LIMIT 1
	       ),80),''), '新对话') AS display_title,
	       IFNULL(LEFT((
	         SELECT m.content FROM messages m
	         WHERE m.conversation_id=c.id AND m.role IN ('user','assistant') AND TRIM(m.content)<>''
	         ORDER BY m.id DESC LIMIT 1
	       ),120),''),
	       IFNULL(c.pinned,0), IFNULL(c.archived,0),
	       CASE WHEN a.conversation_id=c.id THEN 1 ELSE 0 END,
	       c.created_at, c.updated_at
	FROM conversations c
	INNER JOIN managed_agents a ON a.id=c.agent_id
	LEFT JOIN agent_folders f ON f.id=a.folder_id`

// ListAgentConversations 返回全部数字人的最近线程，置顶优先、其余按最近活跃排序。
func (s *Store) ListAgentConversations(ctx context.Context, limit int, includeArchived bool) ([]AgentConversationSummary, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := agentConversationSelect + ` WHERE (? OR IFNULL(c.archived,0)=0)
		ORDER BY IFNULL(c.pinned,0) DESC, c.updated_at DESC, c.id DESC LIMIT ?`
	rows, err := s.db.QueryContext(ctx, query, includeArchived, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AgentConversationSummary, 0)
	for rows.Next() {
		var item AgentConversationSummary
		if err := rows.Scan(
			&item.ID, &item.AgentID, &item.AgentName, &item.Engine, &item.JellyColor,
			&item.GroupName, &item.AgentStatus, &item.TaskUnread, &item.TaskUnreadKind,
			&item.Title, &item.Preview, &item.Pinned, &item.Archived, &item.Active,
			&item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// CreateAndActivateAgentConversation 新建线程并原子切换当前指针，旧线程及消息完整保留。
func (s *Store) CreateAndActivateAgentConversation(ctx context.Context, agentID int64, title string) (*AgentConversationSummary, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx,
		`INSERT INTO conversations (user_ip, mode, agent_id, title) VALUES ('admin','chat',?,?)`,
		agentID, strings.TrimSpace(title))
	if err != nil {
		return nil, err
	}
	conversationID, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	update, err := tx.ExecContext(ctx, `UPDATE managed_agents SET conversation_id=? WHERE id=?`, conversationID, agentID)
	if err != nil {
		return nil, err
	}
	if n, _ := update.RowsAffected(); n == 0 {
		return nil, sql.ErrNoRows
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.getAgentConversation(ctx, agentID, conversationID)
}

// ActivateAgentConversation 仅允许数字人激活自己的线程。
func (s *Store) ActivateAgentConversation(ctx context.Context, agentID, conversationID int64) error {
	res, err := s.db.ExecContext(ctx, `
		UPDATE managed_agents a
		INNER JOIN conversations c ON c.id=? AND c.agent_id=a.id
		SET a.conversation_id=?
		WHERE a.id=?`, conversationID, conversationID, agentID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		var current int64
		err = s.db.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM managed_agents a
			INNER JOIN conversations c ON c.id=? AND c.agent_id=a.id
			WHERE a.id=?`, conversationID, agentID).Scan(&current)
		if err != nil {
			return err
		}
		if current == 0 {
			return sql.ErrNoRows
		}
	}
	return nil
}

// UpdateAgentConversation 更新标题、置顶或归档状态。
func (s *Store) UpdateAgentConversation(ctx context.Context, conversationID int64, patch AgentConversationPatch) error {
	sets := make([]string, 0, 3)
	args := make([]any, 0, 4)
	if patch.Title != nil {
		sets = append(sets, "title=?")
		args = append(args, strings.TrimSpace(*patch.Title))
	}
	if patch.Pinned != nil {
		sets = append(sets, "pinned=?")
		args = append(args, bool01(*patch.Pinned))
	}
	if patch.Archived != nil {
		sets = append(sets, "archived=?")
		args = append(args, bool01(*patch.Archived))
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, conversationID)
	res, err := s.db.ExecContext(ctx, `UPDATE conversations SET `+strings.Join(sets, ",")+` WHERE id=? AND agent_id IS NOT NULL`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) getAgentConversation(ctx context.Context, agentID, conversationID int64) (*AgentConversationSummary, error) {
	row := s.db.QueryRowContext(ctx, agentConversationSelect+` WHERE a.id=? AND c.id=?`, agentID, conversationID)
	var item AgentConversationSummary
	if err := row.Scan(
		&item.ID, &item.AgentID, &item.AgentName, &item.Engine, &item.JellyColor,
		&item.GroupName, &item.AgentStatus, &item.TaskUnread, &item.TaskUnreadKind,
		&item.Title, &item.Preview, &item.Pinned, &item.Archived, &item.Active,
		&item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &item, nil
}
