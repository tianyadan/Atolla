package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"atolla/server/internal/service"
	"atolla/server/internal/store"
)

const defaultGroupChatMessageLimit = 20

// AdminGroupChatsCreate 从当前窗口数字员工建群（3～5 人含群主）。
func (h *Handler) AdminGroupChatsCreate(c *gin.Context) {
	var body struct {
		FromAgentID  int64   `json:"from_agent_id"`
		MemberIDs    []int64 `json:"member_ids"`
		SeedQuestion string  `json:"seed_question"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if body.FromAgentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": service.ErrGroupChatInvalidMemberCount.Error()})
		return
	}
	detail, err := h.svc.CreateGroupChat(c.Request.Context(), body.FromAgentID, body.MemberIDs, body.SeedQuestion)
	if err != nil {
		if errors.Is(err, service.ErrGroupChatInvalidMemberCount) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, service.ErrGroupChatAgentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, detail)
}

// groupChatListItem 列表项：群元数据 + 成员预览（水母叠放用）。
type groupChatListItem struct {
	store.GroupChat
	MemberCount int                   `json:"member_count"`
	Members     []groupChatMemberView `json:"members"`
}

// AdminGroupChatsList 群聊列表（默认 active，按更新时间倒序；含水母预览）。
func (h *Handler) AdminGroupChatsList(c *gin.Context) {
	status := strings.TrimSpace(c.Query("status"))
	items, err := h.svc.Store.ListGroups(c.Request.Context(), status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	out := make([]groupChatListItem, 0, len(items))
	for _, g := range items {
		detail, err := h.svc.Store.GetGroupWithMembers(c.Request.Context(), g.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		members := make([]groupChatMemberView, 0, len(detail.Members))
		for _, m := range detail.Members {
			v := groupChatMemberView{GroupChatMember: m}
			a, err := h.svc.Store.GetManagedAgent(c.Request.Context(), m.AgentID)
			if err == nil && a != nil {
				v.Name = a.Name
				v.JellyColor = a.JellyColor
			}
			members = append(members, v)
		}
		out = append(out, groupChatListItem{
			GroupChat:   g,
			MemberCount: len(members),
			Members:     members,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}

// groupChatMemberView 群成员 + 数字员工展示字段。
type groupChatMemberView struct {
	store.GroupChatMember
	Name       string `json:"name"`
	JellyColor string `json:"jelly_color"`
}

// AdminGroupChatsGet 群详情：成员（名称/水母色）+ 共享会话最近消息。
func (h *Handler) AdminGroupChatsGet(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	detail, err := h.svc.Store.GetGroupWithMembers(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrGroupChatNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	members := make([]groupChatMemberView, 0, len(detail.Members))
	for _, m := range detail.Members {
		v := groupChatMemberView{GroupChatMember: m}
		a, err := h.svc.Store.GetManagedAgent(c.Request.Context(), m.AgentID)
		if err == nil && a != nil {
			v.Name = a.Name
			v.JellyColor = a.JellyColor
		}
		members = append(members, v)
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(defaultGroupChatMessageLimit)))
	beforeID, _ := strconv.ParseInt(c.DefaultQuery("before_id", "0"), 10, 64)
	var msgItems []store.Message
	var total int
	var hasMore bool
	if detail.SharedConversationID > 0 {
		msgItems, total, hasMore, err = h.svc.Store.MessagesPage(c.Request.Context(), detail.SharedConversationID, beforeID, limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	if msgItems == nil {
		msgItems = []store.Message{}
	}

	c.JSON(http.StatusOK, gin.H{
		"id":                     detail.ID,
		"name":                   detail.Name,
		"owner_agent_id":         detail.OwnerAgentID,
		"shared_background":      detail.SharedBackground,
		"shared_conversation_id": detail.SharedConversationID,
		"created_from_agent_id":  detail.CreatedFromAgentID,
		"seed_question":          detail.SeedQuestion,
		"status":                 detail.Status,
		"created_at":             detail.CreatedAt,
		"updated_at":             detail.UpdatedAt,
		"members":                members,
		"messages": gin.H{
			"items":           msgItems,
			"conversation_id": detail.SharedConversationID,
			"total":           total,
			"has_more":        hasMore,
			"limit":           limit,
		},
	})
}

// AdminGroupChatsStartMeeting 首轮主持串行开会（SSE：speaker/chunk/done/meeting_done）。
func (h *Handler) AdminGroupChatsStartMeeting(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	detail, err := h.svc.Store.GetGroupWithMembers(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrGroupChatNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.groupChatSSE(c, detail.SharedConversationID, func(send func(any), onEvent service.AskEventSink) error {
		if err := h.svc.RunGroupMeeting(c.Request.Context(), id, onEvent); err != nil {
			return err
		}
		send(map[string]interface{}{"type": "meeting_done", "group_id": id})
		return nil
	})
}

// AdminGroupChatsAsk 群内续聊（SSE）；无 @ 群主答，有 @ 仅被点名成员串行。
func (h *Handler) AdminGroupChatsAsk(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		Question string `json:"question"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if id <= 0 || strings.TrimSpace(body.Question) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "question required"})
		return
	}
	detail, err := h.svc.Store.GetGroupWithMembers(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrGroupChatNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.groupChatSSE(c, detail.SharedConversationID, func(send func(any), onEvent service.AskEventSink) error {
		return h.svc.AskInGroup(c.Request.Context(), id, body.Question, onEvent)
	})
}

// AdminGroupChatsTransferOwner 转让群主。
func (h *Handler) AdminGroupChatsTransferOwner(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var body struct {
		NewOwnerAgentID int64 `json:"new_owner_agent_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || id <= 0 || body.NewOwnerAgentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	detail, err := h.svc.TransferGroupOwner(c.Request.Context(), id, body.NewOwnerAgentID)
	if err != nil {
		if errors.Is(err, store.ErrGroupChatNotFound) || errors.Is(err, store.ErrGroupMemberNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, store.ErrInvalidGroupChatInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, detail)
}

// AdminGroupChatsSetMemberTag 设置/清空群内标签。
func (h *Handler) AdminGroupChatsSetMemberTag(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	agentID, _ := strconv.ParseInt(c.Param("agentId"), 10, 64)
	var body struct {
		GroupTag string `json:"group_tag"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || id <= 0 || agentID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	detail, err := h.svc.SetGroupMemberTag(c.Request.Context(), id, agentID, body.GroupTag)
	if err != nil {
		if errors.Is(err, store.ErrGroupMemberNotFound) || errors.Is(err, store.ErrGroupChatNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, detail)
}
