package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

const (
	GroupChatStatusActive   = "active"
	GroupChatStatusArchived = "archived"

	GroupMemberRoleOwner  = "owner"
	GroupMemberRoleMember = "member"

	conversationModeGroupChat = "group_chat"
)

// GroupChat PC 群聊元数据。
type GroupChat struct {
	ID                   int64     `json:"id"`
	Name                 string    `json:"name"`
	OwnerAgentID         int64     `json:"owner_agent_id"`
	SharedBackground     string    `json:"shared_background"`
	SharedConversationID int64     `json:"shared_conversation_id"`
	CreatedFromAgentID   int64     `json:"created_from_agent_id"`
	SeedQuestion         string    `json:"seed_question"`
	Status               string    `json:"status"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// GroupChatMember 群成员（含群内标签）。
type GroupChatMember struct {
	GroupID  int64     `json:"group_id"`
	AgentID  int64     `json:"agent_id"`
	Role     string    `json:"role"`
	GroupTag string    `json:"group_tag,omitempty"`
	JoinedAt time.Time `json:"joined_at"`
}

// GroupChatWithMembers 群详情 + 成员列表。
type GroupChatWithMembers struct {
	GroupChat
	Members []GroupChatMember `json:"members"`
}

// CreateGroupInput 建群入参（成员 ID 不含群主，建群时自动加入群主为 owner）。
type CreateGroupInput struct {
	Name               string
	OwnerAgentID       int64
	SharedBackground   string
	CreatedFromAgentID int64
	SeedQuestion       string
	MemberAgentIDs     []int64
}

var (
	ErrGroupChatNotFound    = errors.New("group chat not found")
	ErrGroupMemberNotFound  = errors.New("group member not found")
	ErrInvalidGroupChatInput = errors.New("invalid group chat input")
)

// EnsureGroupChatSchema 幂等创建群聊相关表。
func (s *Store) EnsureGroupChatSchema(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS group_chats (
  id BIGINT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  owner_agent_id BIGINT NOT NULL,
  shared_background TEXT NULL,
  shared_conversation_id BIGINT NOT NULL,
  created_from_agent_id BIGINT NOT NULL,
  seed_question TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gc_owner (owner_agent_id),
  KEY idx_gc_status (status, updated_at),
  KEY idx_gc_conv (shared_conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS group_chat_members (
  group_id BIGINT NOT NULL,
  agent_id BIGINT NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'member',
  group_tag TEXT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, agent_id),
  KEY idx_gcm_agent (agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	return nil
}

// CreateGroupConversation 为群共享时间线分配 conversation id。
func (s *Store) CreateGroupConversation(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO conversations (user_ip, mode) VALUES (?, ?)`,
		"admin", conversationModeGroupChat)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// CreateGroup 建群：分配共享会话并写入成员（群主 role=owner）。
func (s *Store) CreateGroup(ctx context.Context, in CreateGroupInput) (int64, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" || in.OwnerAgentID <= 0 || in.CreatedFromAgentID <= 0 {
		return 0, ErrInvalidGroupChatInput
	}
	memberSet := map[int64]struct{}{in.OwnerAgentID: {}}
	for _, id := range in.MemberAgentIDs {
		if id <= 0 || id == in.OwnerAgentID {
			continue
		}
		memberSet[id] = struct{}{}
	}
	if len(memberSet) < 1 {
		return 0, ErrInvalidGroupChatInput
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx,
		`INSERT INTO conversations (user_ip, mode) VALUES (?, ?)`,
		"admin", conversationModeGroupChat)
	if err != nil {
		return 0, err
	}
	convID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	res, err = tx.ExecContext(ctx, `
INSERT INTO group_chats (
  name, owner_agent_id, shared_background, shared_conversation_id,
  created_from_agent_id, seed_question, status
) VALUES (?,?,?,?,?,?,?)`,
		name, in.OwnerAgentID, in.SharedBackground, convID,
		in.CreatedFromAgentID, in.SeedQuestion, GroupChatStatusActive)
	if err != nil {
		return 0, err
	}
	groupID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	for agentID := range memberSet {
		role := GroupMemberRoleMember
		if agentID == in.OwnerAgentID {
			role = GroupMemberRoleOwner
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO group_chat_members (group_id, agent_id, role) VALUES (?,?,?)`,
			groupID, agentID, role); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return groupID, nil
}

// ListGroups 列出群聊（默认仅 active，按更新时间倒序）。
func (s *Store) ListGroups(ctx context.Context, status string) ([]GroupChat, error) {
	status = strings.TrimSpace(status)
	if status == "" {
		status = GroupChatStatusActive
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT id, name, owner_agent_id, IFNULL(shared_background,''), shared_conversation_id,
       created_from_agent_id, IFNULL(seed_question,''), status, created_at, updated_at
FROM group_chats WHERE status=? ORDER BY updated_at DESC, id DESC`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GroupChat
	for rows.Next() {
		var g GroupChat
		if err := rows.Scan(&g.ID, &g.Name, &g.OwnerAgentID, &g.SharedBackground, &g.SharedConversationID,
			&g.CreatedFromAgentID, &g.SeedQuestion, &g.Status, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// GetGroupWithMembers 读取群详情及全部成员。
func (s *Store) GetGroupWithMembers(ctx context.Context, groupID int64) (*GroupChatWithMembers, error) {
	if groupID <= 0 {
		return nil, ErrInvalidGroupChatInput
	}
	var g GroupChat
	err := s.db.QueryRowContext(ctx, `
SELECT id, name, owner_agent_id, IFNULL(shared_background,''), shared_conversation_id,
       created_from_agent_id, IFNULL(seed_question,''), status, created_at, updated_at
FROM group_chats WHERE id=?`, groupID).Scan(
		&g.ID, &g.Name, &g.OwnerAgentID, &g.SharedBackground, &g.SharedConversationID,
		&g.CreatedFromAgentID, &g.SeedQuestion, &g.Status, &g.CreatedAt, &g.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, ErrGroupChatNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT group_id, agent_id, role, IFNULL(group_tag,''), joined_at
FROM group_chat_members WHERE group_id=? ORDER BY role DESC, agent_id ASC`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var members []GroupChatMember
	for rows.Next() {
		var m GroupChatMember
		if err := rows.Scan(&m.GroupID, &m.AgentID, &m.Role, &m.GroupTag, &m.JoinedAt); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &GroupChatWithMembers{GroupChat: g, Members: members}, nil
}

// UpdateOwner 转让群主：更新 owner_agent_id 与成员 role。
func (s *Store) UpdateOwner(ctx context.Context, groupID, newOwnerAgentID int64) error {
	if groupID <= 0 || newOwnerAgentID <= 0 {
		return ErrInvalidGroupChatInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM group_chats WHERE id=?`, groupID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return ErrGroupChatNotFound
	}
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM group_chat_members WHERE group_id=? AND agent_id=?`,
		groupID, newOwnerAgentID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return ErrGroupMemberNotFound
	}

	res, err := tx.ExecContext(ctx,
		`UPDATE group_chats SET owner_agent_id=? WHERE id=?`, newOwnerAgentID, groupID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrGroupChatNotFound
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE group_chat_members SET role=? WHERE group_id=? AND role=?`,
		GroupMemberRoleMember, groupID, GroupMemberRoleOwner); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE group_chat_members SET role=? WHERE group_id=? AND agent_id=?`,
		GroupMemberRoleOwner, groupID, newOwnerAgentID); err != nil {
		return err
	}
	return tx.Commit()
}

// SetMemberTag 设置或清空成员群内标签（NULL 表示无标签）。
func (s *Store) SetMemberTag(ctx context.Context, groupID, agentID int64, tag string) error {
	if groupID <= 0 || agentID <= 0 {
		return ErrInvalidGroupChatInput
	}
	tag = strings.TrimSpace(tag)
	var res sql.Result
	var err error
	if tag == "" {
		res, err = s.db.ExecContext(ctx,
			`UPDATE group_chat_members SET group_tag=NULL WHERE group_id=? AND agent_id=?`,
			groupID, agentID)
	} else {
		res, err = s.db.ExecContext(ctx,
			`UPDATE group_chat_members SET group_tag=? WHERE group_id=? AND agent_id=?`,
			tag, groupID, agentID)
	}
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrGroupMemberNotFound
	}
	return nil
}

// DeleteGroupChat 删除群、成员，并删掉共享时间线会话（测试清理 / 归档硬删）。
func (s *Store) DeleteGroupChat(ctx context.Context, groupID int64) error {
	if groupID <= 0 {
		return ErrInvalidGroupChatInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var convID int64
	err = tx.QueryRowContext(ctx,
		`SELECT shared_conversation_id FROM group_chats WHERE id=?`, groupID).Scan(&convID)
	if err == sql.ErrNoRows {
		return ErrGroupChatNotFound
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_chat_members WHERE group_id=?`, groupID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_chats WHERE id=?`, groupID); err != nil {
		return err
	}
	if convID > 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM conversations WHERE id=?`, convID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
