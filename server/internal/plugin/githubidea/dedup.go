package githubidea

import (
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strings"
	"time"
)

const (
	claimTTL        = 10 * time.Minute
	maxDedupRecords = 5000
)

type dedupRecord struct {
	Status          string      `json:"status"`
	DeliveryID      string      `json:"delivery_id,omitempty"`
	TaskID          string      `json:"task_id,omitempty"`
	Binding         IdeaBinding `json:"binding,omitempty"`
	WritebackStatus string      `json:"writeback_status,omitempty"`
	WritebackValue  string      `json:"writeback_value,omitempty"`
	UpdatedAt       time.Time   `json:"updated_at"`
}

// IdeaBinding 将队列任务绑定回来源 Issue，用于终态评论回写。
type IdeaBinding struct {
	Repository  string `json:"repository"`
	IssueNumber int    `json:"issue_number"`
	IdeaID      string `json:"idea_id"`
}

// ClaimIdea 原子占用灵感 ID；已完成或仍在有效处理窗口内时返回 false。
func (m *Manager) ClaimIdea(key, deliveryID string) (bool, error) {
	key = strings.ToLower(strings.TrimSpace(key))
	if key == "" {
		return false, errors.New("idea dedup key required")
	}
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	if prior, ok := m.dedup[key]; ok {
		if prior.Status == "done" || (prior.Status == "processing" && now.Sub(prior.UpdatedAt) < claimTTL) {
			return false, nil
		}
	}
	m.dedup[key] = dedupRecord{Status: "processing", DeliveryID: strings.TrimSpace(deliveryID), UpdatedAt: now}
	if err := m.saveDedupLocked(); err != nil {
		return false, err
	}
	return true, nil
}

// CompleteIdea 在任务成功入队后提交去重记录。
func (m *Manager) CompleteIdea(key, taskID string, binding IdeaBinding) error {
	key = strings.ToLower(strings.TrimSpace(key))
	m.mu.Lock()
	defer m.mu.Unlock()
	record := m.dedup[key]
	record.Status = "done"
	record.TaskID = strings.TrimSpace(taskID)
	record.Binding = binding
	record.UpdatedAt = time.Now()
	m.dedup[key] = record
	return m.saveDedupLocked()
}

// ClaimWriteback 保证同一任务终态只回写一次；失败状态允许后续重试。
func (m *Manager) ClaimWriteback(taskID, status string) (IdeaBinding, bool, error) {
	taskID = strings.TrimSpace(taskID)
	status = strings.ToLower(strings.TrimSpace(status))
	if taskID == "" || status == "" {
		return IdeaBinding{}, false, errors.New("writeback task id and status required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	key, record, ok := m.recordByTaskLocked(taskID)
	if !ok {
		return IdeaBinding{}, false, nil
	}
	if record.WritebackStatus == "done" && record.WritebackValue == status {
		return record.Binding, false, nil
	}
	if record.WritebackStatus == "processing" && time.Since(record.UpdatedAt) < claimTTL {
		return record.Binding, false, nil
	}
	record.WritebackStatus = "processing"
	record.WritebackValue = status
	record.UpdatedAt = time.Now()
	m.dedup[key] = record
	if err := m.saveDedupLocked(); err != nil {
		return IdeaBinding{}, false, err
	}
	return record.Binding, true, nil
}

// FinishWriteback 持久化回写结果，用于幂等和失败重试。
func (m *Manager) FinishWriteback(taskID string, ok bool) error {
	taskID = strings.TrimSpace(taskID)
	m.mu.Lock()
	defer m.mu.Unlock()
	key, record, exists := m.recordByTaskLocked(taskID)
	if !exists {
		return nil
	}
	if ok {
		record.WritebackStatus = "done"
	} else {
		record.WritebackStatus = "failed"
	}
	record.UpdatedAt = time.Now()
	m.dedup[key] = record
	return m.saveDedupLocked()
}

func (m *Manager) recordByTaskLocked(taskID string) (string, dedupRecord, bool) {
	for key, record := range m.dedup {
		if record.TaskID == taskID {
			return key, record, true
		}
	}
	return "", dedupRecord{}, false
}

// ReleaseIdea 释放入队失败的占用，使 GitHub 重投时可再次派发。
func (m *Manager) ReleaseIdea(key string) error {
	key = strings.ToLower(strings.TrimSpace(key))
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.dedup, key)
	return m.saveDedupLocked()
}

func (m *Manager) loadDedup() {
	b, err := os.ReadFile(m.dedupPath)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil {
		m.loadErr = errors.Join(m.loadErr, err)
		return
	}
	if err := json.Unmarshal(b, &m.dedup); err != nil {
		m.loadErr = errors.Join(m.loadErr, err)
	}
	if m.dedup == nil {
		m.dedup = map[string]dedupRecord{}
	}
}

func (m *Manager) saveDedupLocked() error {
	if len(m.dedup) > maxDedupRecords {
		type row struct {
			key string
			at  time.Time
		}
		rows := make([]row, 0, len(m.dedup))
		for key, value := range m.dedup {
			rows = append(rows, row{key: key, at: value.UpdatedAt})
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i].at.Before(rows[j].at) })
		for _, item := range rows[:len(rows)-maxDedupRecords] {
			delete(m.dedup, item.key)
		}
	}
	b, err := json.MarshalIndent(m.dedup, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.dedupPath + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, m.dedupPath); err != nil {
		return err
	}
	return os.Chmod(m.dedupPath, 0o600)
}
